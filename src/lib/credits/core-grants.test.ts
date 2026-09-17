import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'
import {
  adjustCreditBalances,
  grantAvailableCredits,
  grantPendingCredits,
} from '@/lib/credits/core'
import { getDetailedBalance } from '@/lib/credit-balance-tracker'

const PREFIX = `credits-core-${Date.now()}`

async function seedCredits(username: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO Credits
      (hive_username, pending_amount, available_amount, total_issued, total_consumed)
      VALUES (?, 2, 3, 5, 0)`,
    args: [username],
  })
}

describe('Credits core grants and adjustments', () => {
  beforeAll(async () => {
    expect(await initializeDatabase()).toBe(true)
  })

  afterAll(async () => {
    await db.execute({
      sql: 'DELETE FROM CreditAudit WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
    await db.execute({
      sql: 'DELETE FROM Credits WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
  })

  it('grants pending credits through the core and audits the grant', async () => {
    const username = `${PREFIX}-pending`
    await grantPendingCredits({
      hiveUsername: username,
      amount: 6,
      reason: 'admin assignment',
      performedBy: 'admin',
    })

    const balance = await db.execute({
      sql: 'SELECT pending_amount, available_amount, total_issued FROM Credits WHERE hive_username = ?',
      args: [username],
    })
    expect(balance.rows[0]).toMatchObject({
      pending_amount: 6,
      available_amount: 0,
      total_issued: 6,
    })
  })

  it('grants available credits without a claim transition', async () => {
    const username = `${PREFIX}-available`
    await grantAvailableCredits({
      hiveUsername: username,
      amount: 8,
      reason: 'purchase settlement',
      externalReference: `hive:payment:${PREFIX}:0`,
    })

    const balance = await getDetailedBalance(username)
    expect(balance.available_amount).toBe(8)
    expect(balance.pending_amount).toBe(0)
    expect(balance.total_issued).toBe(8)
    expect(balance.is_consistent).toBe(true)
    expect(balance.breakdown.granted_available).toBe(8)
  })

  it('adjusts pending and available deltas atomically and separately', async () => {
    const username = `${PREFIX}-adjust`
    await seedCredits(username)

    const result = await adjustCreditBalances({
      hiveUsername: username,
      pendingAmount: 5,
      availableAmount: 1,
      reason: 'correction',
      performedBy: 'admin',
    })

    expect(result).toMatchObject({
      pending_amount: 5,
      available_amount: 1,
      total_issued: 5,
    })
    const audit = await db.execute({
      sql: `SELECT operation, amount FROM CreditAudit
        WHERE hive_username = ? ORDER BY id ASC`,
      args: [username],
    })
    expect(audit.rows).toEqual([
      { operation: 'admin_adjust_pending', amount: 3 },
      { operation: 'admin_adjustment', amount: -2 },
    ])
  })

  it('rejects non-integer and negative core amounts', async () => {
    await expect(
      grantAvailableCredits({
        hiveUsername: `${PREFIX}-invalid`,
        amount: 1.5,
        reason: 'invalid',
      })
    ).rejects.toThrow('positive safe integer')
    await expect(
      adjustCreditBalances({
        hiveUsername: `${PREFIX}-invalid`,
        pendingAmount: -1,
        reason: 'invalid',
        performedBy: 'admin',
      })
    ).rejects.toThrow('non-negative safe integer')
  })
})
