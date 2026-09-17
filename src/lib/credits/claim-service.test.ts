import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'
import {
  CLAIM_INTENT_TTL_MS,
  completeClaim,
  createClaimIntent,
} from '@/lib/credits/claim-service'
import type { VerifiedHiveClaim } from '@/lib/credits/adapters/hive-claim-adapter'

const PREFIX = `credits-claim-${Date.now()}`

function proof(
  username: string,
  hash: string,
  operationIndex = 0
): VerifiedHiveClaim {
  const transactionId = hash
  return {
    username,
    hash,
    transactionId,
    operationIndex,
    externalReference: `hive:claim:${transactionId}:${operationIndex}`,
  }
}

async function seedCredits(username: string, pending: number): Promise<void> {
  await db.execute({
    sql: `INSERT INTO Credits
      (hive_username, pending_amount, available_amount, total_issued, total_consumed)
      VALUES (?, ?, 0, ?, 0)`,
    args: [username, pending, pending],
  })
}

describe('persistent credit claim service', () => {
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
    await db.execute({
      sql: 'DELETE FROM Credits WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
  })

  it('persists an intent with a pending amount snapshot', async () => {
    const username = `${PREFIX}-snapshot`
    const hash = '1'.repeat(64)
    await seedCredits(username, 7)

    const result = await createClaimIntent(username, {
      now: 10_000,
      hashFactory: () => hash,
    })

    expect(result).toEqual({
      ok: true,
      intent: {
        hash,
        hiveUsername: username,
        amount: 7,
        createdAt: 10_000,
        expiresAt: 10_000 + CLAIM_INTENT_TTL_MS,
      },
    })
  })

  it('moves the snapshot once and returns the committed balance', async () => {
    const username = `${PREFIX}-complete`
    const hash = '2'.repeat(64)
    await seedCredits(username, 5)
    await createClaimIntent(username, { hashFactory: () => hash, now: 20_000 })

    const result = await completeClaim(proof(username, hash), 20_001)
    expect(result).toEqual({
      ok: true,
      credits: 5,
      available: 5,
      pending: 0,
      newBalance: 5,
    })

    const audit = await db.execute({
      sql: `SELECT amount, external_reference FROM CreditAudit
        WHERE hive_username = ?`,
      args: [username],
    })
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]).toMatchObject({
      amount: 5,
      external_reference: `hive:claim:${hash}:0`,
    })
  })

  it('lets only one concurrent completion consume an intent', async () => {
    const username = `${PREFIX}-race`
    const hash = '3'.repeat(64)
    await seedCredits(username, 9)
    await createClaimIntent(username, { hashFactory: () => hash, now: 30_000 })

    const results = await Promise.all([
      completeClaim(proof(username, hash), 30_001),
      completeClaim(proof(username, hash), 30_001),
    ])

    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(
      results.filter(result => !result.ok && result.code === 'intent_not_found')
    ).toHaveLength(1)

    const balance = await db.execute({
      sql: 'SELECT pending_amount, available_amount FROM Credits WHERE hive_username = ?',
      args: [username],
    })
    expect(balance.rows[0]).toMatchObject({
      pending_amount: 0,
      available_amount: 9,
    })
  })

  it('rolls back intent consumption when the external reference already exists', async () => {
    const username = `${PREFIX}-duplicate`
    const hash = '4'.repeat(64)
    const externalReference = `hive:claim:${hash}:0`
    await seedCredits(username, 4)
    await db.execute({
      sql: `INSERT INTO CreditAudit
        (hive_username, operation, amount, reason, external_reference)
        VALUES (?, ?, ?, ?, ?)`,
      args: [username, 'claim_credits', 4, 'existing', externalReference],
    })
    await createClaimIntent(username, { hashFactory: () => hash, now: 40_000 })

    const result = await completeClaim(proof(username, hash), 40_001)
    expect(result).toMatchObject({ ok: false, code: 'duplicate_reference' })

    const intent = await db.execute({
      sql: 'SELECT hash FROM CreditClaimIntents WHERE hash = ?',
      args: [hash],
    })
    expect(intent.rows).toHaveLength(1)
    const balance = await db.execute({
      sql: 'SELECT pending_amount, available_amount FROM Credits WHERE hive_username = ?',
      args: [username],
    })
    expect(balance.rows[0]).toMatchObject({
      pending_amount: 4,
      available_amount: 0,
    })
  })

  it('keeps an intent when pending credits became insufficient', async () => {
    const username = `${PREFIX}-insufficient`
    const hash = '5'.repeat(64)
    await seedCredits(username, 3)
    await createClaimIntent(username, { hashFactory: () => hash, now: 50_000 })
    await db.execute({
      sql: 'UPDATE Credits SET pending_amount = 0 WHERE hive_username = ?',
      args: [username],
    })

    const result = await completeClaim(proof(username, hash), 50_001)
    expect(result).toMatchObject({ ok: false, code: 'insufficient_pending' })

    const intent = await db.execute({
      sql: 'SELECT hash FROM CreditClaimIntents WHERE hash = ?',
      args: [hash],
    })
    expect(intent.rows).toHaveLength(1)
  })
})
