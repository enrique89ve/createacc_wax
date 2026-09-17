import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'

const PREFIX = `credits-schema-${Date.now()}`

describe('Credits v1 schema contracts', () => {
  beforeAll(async () => {
    expect(await initializeDatabase()).toBe(true)
  })

  afterAll(async () => {
    await db.execute({
      sql: 'DELETE FROM CreditClaimIntents WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
    await db.execute({
      sql: 'DELETE FROM CreditAudit WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
  })

  it('stores claim intents with positive amounts and a valid lifetime', async () => {
    const username = `${PREFIX}-intent`
    const hash = 'a'.repeat(64)
    const now = Date.now()

    await db.execute({
      sql: `INSERT INTO CreditClaimIntents
        (hash, hive_username, amount, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)`,
      args: [hash, username, 20, now, now + 600_000],
    })

    const result = await db.execute({
      sql: 'SELECT hash, hive_username, amount FROM CreditClaimIntents WHERE hash = ?',
      args: [hash],
    })

    expect(result.rows[0]).toMatchObject({
      hash,
      hive_username: username,
      amount: 20,
    })

    await expect(
      db.execute({
        sql: `INSERT INTO CreditClaimIntents
          (hash, hive_username, amount, created_at, expires_at)
          VALUES (?, ?, ?, ?, ?)`,
        args: ['b'.repeat(64), username, 0, now, now + 600_000],
      })
    ).rejects.toThrow()
  })

  it('enforces one non-null audit reference while allowing null references', async () => {
    const username = `${PREFIX}-audit`
    const reference = `hive:claim:${PREFIX}:0`
    const insert = (externalReference: string | null) =>
      db.execute({
        sql: `INSERT INTO CreditAudit
          (hive_username, operation, amount, reason, external_reference)
          VALUES (?, ?, ?, ?, ?)`,
        args: [username, 'claim_credits', 1, 'schema test', externalReference],
      })

    await insert(reference)
    await insert(null)
    await insert(null)

    await expect(insert(reference)).rejects.toThrow()
  })
})
