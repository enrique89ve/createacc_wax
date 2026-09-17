import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase, withTransaction } from '@/lib/database'
import { assignCredits } from '@/lib/credits/admin'
import { deductCreditsForTicket } from '@/lib/credits/core'
import { getBalance } from '@/lib/credit-balance-tracker'
import { UserRole } from '@/lib/roles'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'

const PREFIX = `stateless-auth-${Date.now()}`

async function countBuilderUsers(): Promise<number> {
  const result = await db.execute({
    sql: `SELECT COUNT(*) as count FROM "user" WHERE role = ?`,
    args: [UserRole.Builder],
  })
  return Number(
    (result.rows[0] as unknown as unknown as { count: number }).count
  )
}

describe('stateless builder identity and credit ownership', () => {
  beforeAll(async () => {
    await initializeDatabase()
  })

  afterAll(async () => {
    await db.execute({
      sql: `DELETE FROM Credits WHERE hive_username LIKE ?`,
      args: [`${PREFIX}%`],
    })
    await db.execute({
      sql: `DELETE FROM CreditAudit WHERE hive_username LIKE ?`,
      args: [`${PREFIX}%`],
    })
    await db.execute({
      sql: `DELETE FROM Tickets WHERE creator_username LIKE ?`,
      args: [`${PREFIX}%`],
    })
  })

  it('never has builder rows in user', async () => {
    expect(await countBuilderUsers()).toBe(0)
  })

  it('treats a missing credits row as zero without creating one', async () => {
    const username = `${PREFIX}-zero`
    const before = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM Credits WHERE hive_username = ?',
      args: [username],
    })
    expect(Number((before.rows[0] as unknown as { count: number }).count)).toBe(
      0
    )

    const balance = await getBalance(username)
    expect(balance.available_amount).toBe(0)
    expect(balance.pending_amount).toBe(0)
    expect(balance.is_consistent).toBe(true)

    const after = await db.execute({
      sql: 'SELECT COUNT(*) as count FROM Credits WHERE hive_username = ?',
      args: [username],
    })
    expect(Number((after.rows[0] as unknown as { count: number }).count)).toBe(
      0
    )
  })

  it('lets admin assign credits to a username that never logged in', async () => {
    const username = `${PREFIX}-never-login`
    await assignCredits({
      hive_username: username,
      amount: 7,
      source: 'test-assign-before-login',
      assigned_by_admin: 'admin',
    })
    const balance = await getBalance(username)
    expect(balance.pending_amount).toBe(7)
    expect(await countBuilderUsers()).toBe(0)
  })

  it('rejects ticket creation without available credits', async () => {
    const username = `${PREFIX}-no-spend`
    await expect(
      deductCreditsForTicket(username, 1, `${PREFIX}-ticket`)
    ).rejects.toThrow('Insufficient credits')
  })

  it('decreases available credits atomically on ticket creation', async () => {
    const username = `${PREFIX}-spend`
    await db.execute({
      sql: `INSERT INTO Credits (hive_username, available_amount, total_issued) VALUES (?, 2, 2)`,
      args: [username],
    })
    await deductCreditsForTicket(username, 1, `${PREFIX}-t1`)
    const balance = await getBalance(username)
    expect(balance.available_amount).toBe(1)
  })

  it('lets only one of two concurrent spends succeed when balance is 1', async () => {
    const username = `${PREFIX}-race`
    await db.execute({
      sql: `INSERT INTO Credits (hive_username, available_amount, total_issued) VALUES (?, 1, 1)`,
      args: [username],
    })

    const results = await Promise.allSettled([
      deductCreditsForTicket(username, 1, `${PREFIX}-race-a`),
      deductCreditsForTicket(username, 1, `${PREFIX}-race-b`),
    ])

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length
    expect(succeeded).toBe(1)
    expect(failed).toBe(1)

    const balance = await getBalance(username)
    expect(balance.available_amount).toBe(0)
  })

  it('scopes ticket ownership by creator_username', async () => {
    const alice = `${PREFIX}-alice`
    const bob = `${PREFIX}-bob`
    await db.execute({
      sql: `INSERT INTO Tickets (code, total_uses, remaining_uses, creator_username) VALUES (?, 1, 1, ?)`,
      args: [`${PREFIX}-alice-ticket`, alice],
    })
    const owned = await db.execute({
      sql: `SELECT COUNT(*) as count FROM Tickets WHERE creator_username = ?`,
      args: [alice],
    })
    const foreign = await db.execute({
      sql: `SELECT COUNT(*) as count FROM Tickets WHERE creator_username = ?`,
      args: [bob],
    })
    expect(Number((owned.rows[0] as unknown as { count: number }).count)).toBe(
      1
    )
    expect(
      Number((foreign.rows[0] as unknown as { count: number }).count)
    ).toBe(0)

    const steal = await db.execute({
      sql: `UPDATE Tickets SET description = 'stolen' WHERE code = ? AND creator_username = ?`,
      args: [`${PREFIX}-alice-ticket`, bob],
    })
    expect(steal.rowsAffected).toBe(0)
  })

  it('applies concurrent ticket use deltas to the current state', async () => {
    const username = `${PREFIX}-relative-update`
    const code = `${PREFIX}-relative-ticket`
    const ticket = await db.execute({
      sql: `INSERT INTO Tickets (code, total_uses, remaining_uses, creator_username) VALUES (?, 10, 10, ?) RETURNING id`,
      args: [code, username],
    })
    const ticketId = Number(ticket.rows[0]?.id)

    await Promise.all([
      withTransaction(() =>
        ticketsRepository.updateOwnedUses(ticketId, username, 1)
      ),
      withTransaction(() =>
        ticketsRepository.updateOwnedUses(ticketId, username, 2)
      ),
    ])

    const result = await db.execute({
      sql: 'SELECT total_uses, remaining_uses FROM Tickets WHERE code = ?',
      args: [code],
    })
    expect(result.rows[0]).toMatchObject({ total_uses: 13, remaining_uses: 13 })
  })
})
