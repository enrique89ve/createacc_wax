import { describe, expect, it } from 'vitest'
import {
  encodeJson,
  signPayload,
  verifySignedPayload,
} from '@/lib/auth/signed-cookie'
import { UserRole } from '@/lib/roles'
import type { BuilderSession } from '@/types/auth'

const SECRET = 'test-session-secret-for-hmac'

function isBuilderSession(value: unknown): value is BuilderSession {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.username === 'string' &&
    record.role === UserRole.Builder &&
    typeof record.issuedAt === 'number' &&
    typeof record.expiresAt === 'number'
  )
}

describe('signed builder session cookie', () => {
  it('rejects a tampered cookie', () => {
    const session: BuilderSession = {
      username: 'alice',
      role: UserRole.Builder,
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }
    const signed = signPayload(encodeJson(session), SECRET)
    const tampered = `${signed.slice(0, -4)}xxxx`
    expect(verifySignedPayload(tampered, SECRET)).toBeNull()
  })

  it('rejects an expired session payload', () => {
    const session: BuilderSession = {
      username: 'alice',
      role: UserRole.Builder,
      issuedAt: Date.now() - 120_000,
      expiresAt: Date.now() - 1,
    }
    const signed = signPayload(encodeJson(session), SECRET)
    const verified = verifySignedPayload(signed, SECRET)
    expect(verified).not.toBeNull()
    const decoded = JSON.parse(
      Buffer.from(verified as string, 'base64url').toString('utf-8')
    )
    expect(isBuilderSession(decoded)).toBe(true)
    expect(decoded.expiresAt).toBeLessThan(Date.now())
  })
})
