import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  db,
  execute,
  executeWrite,
  initializeDatabase,
  withReadSnapshot,
  withTransaction,
} from '@/lib/database'

const CODE = `SNAP${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`

function deferred(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

beforeAll(async () => {
  expect(await initializeDatabase()).toBe(true)
})

afterAll(async () => {
  await executeWrite({
    sql: `DELETE FROM Tickets WHERE code = ?`,
    args: [CODE],
  })
})

describe('database access contract', () => {
  it('enables and verifies foreign key enforcement', async () => {
    const result = await db.execute({ sql: 'PRAGMA foreign_keys', args: [] })
    expect(Number(result.rows[0]?.foreign_keys)).toBe(1)
    await expect(
      executeWrite({
        sql: `INSERT INTO Tickets (
          code, total_uses, remaining_uses, creator_username,
          funding_source, owner_builder_username, issuer_admin_id
        ) VALUES (?, 1, 1, 'system', 'system', NULL, 'missing-admin')`,
        args: [CODE],
      })
    ).rejects.toThrow()
  })

  it('enforces foreign keys inside dedicated write transactions', async () => {
    const username = `fk${crypto.randomUUID().replace(/-/g, '')}`
    try {
      await expect(
        withTransaction(() =>
          executeWrite({
            sql: `INSERT INTO Accounts (
              username, ticket, ticket_id, execution_mode,
              blockchain_status, rc_delegated, rc_status
            ) VALUES (?, 'missing-ticket', -1, 'simulate', 'simulated', 0, 'pending')`,
            args: [username],
          })
        )
      ).rejects.toThrow()
    } finally {
      await executeWrite({
        sql: 'DELETE FROM Accounts WHERE username = ?',
        args: [username],
      })
    }
  })

  it('holds a coherent read snapshot while a local transaction waits', async () => {
    const readerEntered = deferred()
    const allowReaderToFinish = deferred()
    let writerEntered = false

    const reader = withReadSnapshot(async () => {
      const first = await execute({
        sql: 'SELECT COUNT(*) AS count FROM Tickets WHERE code = ?',
        args: [CODE],
      })
      readerEntered.resolve()
      await allowReaderToFinish.promise
      const second = await execute({
        sql: 'SELECT COUNT(*) AS count FROM Tickets WHERE code = ?',
        args: [CODE],
      })
      return [Number(first.rows[0]?.count), Number(second.rows[0]?.count)]
    })

    await readerEntered.promise
    const writer = withTransaction(async () => {
      writerEntered = true
      await executeWrite({
        sql: `INSERT INTO Tickets (
          code, total_uses, remaining_uses, creator_username,
          funding_source, owner_builder_username
        ) VALUES (?, 1, 1, 'snapshot-test', 'builder_credits', 'snapshot-test')`,
        args: [CODE],
      })
    })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(writerEntered).toBe(false)

    allowReaderToFinish.resolve()
    await expect(reader).resolves.toEqual([0, 0])
    await writer
    expect(writerEntered).toBe(true)
  })

  it('rejects an attempted write transaction nested in a read snapshot', async () => {
    await expect(
      withReadSnapshot(() => withTransaction(async () => undefined))
    ).rejects.toThrow('Cannot start a write transaction inside a read snapshot')
  })
})
