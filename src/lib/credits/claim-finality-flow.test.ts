import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'
import {
  verifyHiveClaim,
  type HiveTransactionStatus,
} from '@/lib/credits/adapters/hive-claim-adapter'
import { completeClaim, createClaimIntent } from '@/lib/credits/claim-service'
import { grantPendingCredits } from '@/lib/credits/core'

const PREFIX = `credits-finality-${Date.now()}`
const USERNAME = `${PREFIX}-builder`
const HASH = 'a'.repeat(64)
const TRANSACTION_ID = 'b'.repeat(64)
const NOW = Date.parse('2026-09-17T12:00:00.000Z')

function transactionPayload(): Record<string, unknown> {
  return {
    transaction_id: TRANSACTION_ID,
    timestamp: '2026-09-17T11:59:00.000Z',
    transaction_json: {
      operations: [
        {
          type: 'custom_json_operation',
          value: {
            id: 'claim_credits',
            json: JSON.stringify({
              app: 'holahiveCreateAcc',
              hash: HASH,
              username: USERNAME,
              timestamp: NOW,
              action: 'claim_credits',
            }),
            required_posting_auths: [USERNAME],
          },
        },
      ],
    },
  }
}

describe('reversible to irreversible claim flow', () => {
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

  it('keeps the intent pending until the same transaction is irreversible', async () => {
    await grantPendingCredits({
      hiveUsername: USERNAME,
      amount: 6,
      reason: 'finality test',
      performedBy: 'test',
    })
    const intent = await createClaimIntent(USERNAME, {
      now: NOW,
      hashFactory: () => HASH,
    })
    expect(intent.ok).toBe(true)

    let status: HiveTransactionStatus = 'within_reversible_block'
    const provider = {
      getStatus: async () => ({ status }),
      getTransaction: async () => transactionPayload(),
    }
    const input = {
      transactionId: TRANSACTION_ID,
      hash: HASH,
      username: USERNAME,
    }

    const pendingResult = await verifyHiveClaim(input, provider, NOW)
    expect(pendingResult).toMatchObject({ ok: false, kind: 'pending' })

    const pendingIntent = await db.execute({
      sql: 'SELECT hash FROM CreditClaimIntents WHERE hash = ?',
      args: [HASH],
    })
    expect(pendingIntent.rows).toHaveLength(1)

    status = 'within_irreversible_block'
    const finalResult = await verifyHiveClaim(input, provider, NOW)
    expect(finalResult.ok).toBe(true)
    if (!finalResult.ok) return

    const completion = await completeClaim(finalResult.claim, NOW + 1)
    expect(completion).toMatchObject({
      ok: true,
      credits: 6,
      available: 6,
      pending: 0,
    })
  })
})
