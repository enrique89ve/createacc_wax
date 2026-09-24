import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'
import { diagnoseDatabaseConsistency } from '@/lib/database-diagnostics'
import { inspectDatabaseSchema } from '@/lib/database-schema-preflight'

const RUN = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
const BUILDER = `diagbuilder${RUN}`
const TICKET = `DIAG${RUN.toUpperCase()}`

async function cleanup(): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM Tickets WHERE code = ?',
    args: [TICKET],
  })
  await db.execute({
    sql: 'DELETE FROM CreditAudit WHERE hive_username = ?',
    args: [BUILDER],
  })
  await db.execute({
    sql: 'DELETE FROM Credits WHERE hive_username = ?',
    args: [BUILDER],
  })
}

beforeAll(async () => {
  expect(await initializeDatabase()).toBe(true)
  await cleanup()
  await db.execute({
    sql: `INSERT INTO Credits (
      hive_username, pending_amount, available_amount, total_issued, total_consumed
    ) VALUES (?, 0, 3, 3, 1)`,
    args: [BUILDER],
  })
  await db.execute({
    sql: `INSERT INTO CreditAudit (
      hive_username, operation, amount, reason, external_reference
    ) VALUES (?, 'consume_credits', -1, 'diagnostic fixture', ?)`,
    args: [BUILDER, `diagnostic:${RUN}:consume`],
  })
  await db.execute({
    sql: `INSERT INTO Tickets (
      code, total_uses, remaining_uses, creator_username,
      funding_source, owner_builder_username
    ) VALUES (?, 2, 1, ?, 'builder_credits', ?)`,
    args: [TICKET, BUILDER, BUILDER],
  })
})

afterAll(cleanup)

describe('database consistency diagnostics', () => {
  it('reports credit ledger and ticket-use differences without repairing them', async () => {
    const preflight = await inspectDatabaseSchema()
    expect(preflight.schemaCompatible).toBe(true)
    expect(preflight.foreignKeysEnabled).toBe(true)

    const report = await diagnoseDatabaseConsistency()

    expect(report.databaseMode).toBe('sqlite-local')
    expect(report.criticalCount).toBe(report.issueCount)
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'credit_available_amount_ledger_mismatch',
          reference: BUILDER,
        }),
        expect.objectContaining({
          code: 'ticket_use_conservation_mismatch',
          reference: expect.stringContaining(TICKET),
        }),
        expect.objectContaining({
          code: 'builder_consumed_account_mismatch',
          reference: BUILDER,
        }),
      ])
    )

    const balance = await db.execute({
      sql: 'SELECT available_amount FROM Credits WHERE hive_username = ?',
      args: [BUILDER],
    })
    expect(Number(balance.rows[0]?.available_amount)).toBe(3)
  })
})
