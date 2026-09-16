import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

vi.mock('@/lib/admin/auth/hive-signature-verifier', () => ({
  quickVerifySignature: vi.fn(),
}))

import { quickVerifySignature } from '@/lib/admin/auth/hive-signature-verifier'
import { db, initializeDatabase } from '@/lib/database'
import { UserRole } from '@/lib/roles'
import {
  canonicalAuthOrigin,
  consumeBuilderChallenge,
  createBuilderChallenge,
  verifyBuilderLogin,
} from '@/lib/auth/builder-auth'

const mockVerify = vi.mocked(quickVerifySignature)
const PREFIX = `auth-bound-${Date.now()}`

async function countUserRows(username: string): Promise<number> {
  const result = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM "user" WHERE username = ?',
    args: [username],
  })
  return Number((result.rows[0] as unknown as { count: number }).count)
}

async function countBuilderRoleRows(): Promise<number> {
  const result = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM "user" WHERE role = ?',
    args: [UserRole.Builder],
  })
  return Number((result.rows[0] as unknown as { count: number }).count)
}

describe('builder auth challenges', () => {
  beforeAll(async () => {
    await initializeDatabase()
  })

  beforeEach(async () => {
    mockVerify.mockReset()
    await db.execute({ sql: 'DELETE FROM BuilderAuthChallenges', args: [] })
  })

  afterAll(async () => {
    await db.execute({ sql: 'DELETE FROM BuilderAuthChallenges', args: [] })
  })

  it('stores a server-built message bound to the canonical origin', async () => {
    const username = `${PREFIX}-origin`
    const result = await createBuilderChallenge(username)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.message).toContain(
      `Login to HiveAccount Creation at ${canonicalAuthOrigin()}`
    )
    expect(result.value.message).toContain(`Username: ${username}`)
    expect(result.value.message).toMatch(/\nNonce: [0-9a-f]{64}$/)
  })

  it('consumes a challenge only once', async () => {
    const username = `${PREFIX}-once`
    const created = await createBuilderChallenge(username)
    expect(created.ok).toBe(true)

    expect(await consumeBuilderChallenge(username)).toBeTypeOf('string')
    expect(await consumeBuilderChallenge(username)).toBeNull()
  })

  it('rejects a message signed for a different origin', async () => {
    const username = `${PREFIX}-phish`
    const created = await createBuilderChallenge(username)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const forged = created.value.message.replace(
      canonicalAuthOrigin(),
      'https://evil.example'
    )
    mockVerify.mockResolvedValue({ valid: true })

    const result = await verifyBuilderLogin({
      username,
      publicKey: 'STM7public',
      signature: 'sig',
      message: forged,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/does not match/i)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('rejects a replayed signed message', async () => {
    const username = `${PREFIX}-replay`
    const created = await createBuilderChallenge(username)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    mockVerify.mockResolvedValue({ valid: true })
    const first = await verifyBuilderLogin({
      username,
      publicKey: 'STM7public',
      signature: 'sig',
      message: created.value.message,
    })
    expect(first.ok).toBe(true)

    const second = await verifyBuilderLogin({
      username,
      publicKey: 'STM7public',
      signature: 'sig',
      message: created.value.message,
    })
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.error).toMatch(/already used|expired|Invalid/i)
  })

  it('rejects an expired challenge', async () => {
    const username = `${PREFIX}-expired`
    await db.execute({
      sql: `
				INSERT INTO BuilderAuthChallenges (username, nonce_hash, message, expires_at)
				VALUES (?, ?, ?, ?)
			`,
      args: [
        username,
        'a'.repeat(64),
        `Login to HiveAccount Creation at ${canonicalAuthOrigin()}\nUsername: ${username}\nTimestamp: 1\nNonce: ${'b'.repeat(64)}`,
        Date.now() - 1,
      ],
    })

    mockVerify.mockResolvedValue({ valid: true })
    const result = await verifyBuilderLogin({
      username,
      publicKey: 'STM7public',
      signature: 'sig',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/expired|already used|Invalid/i)
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('does not create a user row after a valid signature', async () => {
    const username = `${PREFIX}-norow`
    const created = await createBuilderChallenge(username)
    expect(created.ok).toBe(true)
    if (!created.ok) return

    mockVerify.mockResolvedValue({ valid: true })
    const result = await verifyBuilderLogin({
      username,
      publicKey: 'STM7public',
      signature: 'sig',
      message: created.value.message,
    })
    expect(result.ok).toBe(true)
    expect(await countUserRows(username)).toBe(0)
    expect(await countBuilderRoleRows()).toBe(0)
  })
})
