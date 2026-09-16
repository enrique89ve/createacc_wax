import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initializeDatabase, db } from '@/lib/database'
import {
  RECONCILIATION_CONFIG,
  RECONCILIATION_STATUS,
} from '@/consts/constants'
import {
  claimReconciliationEntry,
  getPendingReconciliations,
  markReconciliationAbandoned,
  markReconciliationFailed,
  markReconciliationResolved,
  resetStuckProcessingEntries,
} from '@/utils/db-ticket-validator'

const RUN = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
const TICKET = `RECON${RUN.toUpperCase()}`
const RESOLVER = 'vitest-reconciliation'

async function insertEntry(params: {
  readonly correlationId: string
  readonly username: string
  readonly status?: string
  readonly attemptCount?: number
  readonly processingSinceSql?: string
}): Promise<number> {
  const result = await db.execute({
    sql: `INSERT INTO ReconciliationQueue (
			correlation_id, username, ticket_code, reason, status, attempt_count, processing_since
		) VALUES (?, ?, ?, 'ambiguous_chain_error', ?, ?, ${params.processingSinceSql ?? 'NULL'})
		RETURNING id`,
    args: [
      params.correlationId,
      params.username,
      TICKET,
      params.status ?? RECONCILIATION_STATUS.PENDING,
      params.attemptCount ?? 0,
    ],
  })
  return Number(result.rows[0]?.id)
}

async function statusOf(id: number): Promise<{
  readonly status: string
  readonly attemptCount: number
}> {
  const result = await db.execute({
    sql: `SELECT status, attempt_count FROM ReconciliationQueue WHERE id = ?`,
    args: [id],
  })
  return {
    status: String(result.rows[0]?.status),
    attemptCount: Number(result.rows[0]?.attempt_count),
  }
}

beforeAll(async () => {
  const ok = await initializeDatabase()
  expect(ok).toBe(true)
  await db.execute({
    sql: `DELETE FROM ReconciliationQueue WHERE ticket_code = ?`,
    args: [TICKET],
  })
}, 30_000)

afterAll(async () => {
  await db.execute({
    sql: `DELETE FROM ReconciliationQueue WHERE ticket_code = ?`,
    args: [TICKET],
  })
})

describe('reconciliation state machine', () => {
  it('pending → processing → resolved', async () => {
    const id = await insertEntry({
      correlationId: `corr-ok-${RUN}`,
      username: `recok${RUN.slice(0, 8)}`,
    })
    expect(await claimReconciliationEntry(id, RESOLVER)).toBe(true)
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.PROCESSING,
      attemptCount: 1,
    })
    expect(await markReconciliationResolved(id, RESOLVER)).toBe(true)
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.RESOLVED,
    })
    const pending = await getPendingReconciliations()
    expect(pending.some(entry => entry.id === id)).toBe(false)
  })

  it('failed → retry claim', async () => {
    const id = await insertEntry({
      correlationId: `corr-retry-${RUN}`,
      username: `retry${RUN.slice(0, 8)}`,
    })
    expect(await claimReconciliationEntry(id, RESOLVER)).toBe(true)
    expect(await markReconciliationFailed(id, 'simulated failure')).toBe(true)
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.FAILED,
    })
    expect(await claimReconciliationEntry(id, RESOLVER)).toBe(true)
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.PROCESSING,
      attemptCount: 2,
    })
  })

  it('stale processing resets to failed', async () => {
    const id = await insertEntry({
      correlationId: `corr-stale-${RUN}`,
      username: `stale${RUN.slice(0, 8)}`,
      status: RECONCILIATION_STATUS.PROCESSING,
      processingSinceSql: `datetime('now', '-10 minutes')`,
    })
    expect(
      await resetStuckProcessingEntries(
        RECONCILIATION_CONFIG.PROCESSING_TIMEOUT_MS
      )
    ).toBeGreaterThan(0)
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.FAILED,
    })
  })

  it('MAX_ATTEMPTS claim can be abandoned', async () => {
    const id = await insertEntry({
      correlationId: `corr-max-${RUN}`,
      username: `recmax${RUN.slice(0, 7)}`,
      status: RECONCILIATION_STATUS.FAILED,
      attemptCount: RECONCILIATION_CONFIG.MAX_ATTEMPTS,
    })
    const before = await statusOf(id)
    expect(before.attemptCount).toBe(RECONCILIATION_CONFIG.MAX_ATTEMPTS)
    expect(await claimReconciliationEntry(id, RESOLVER)).toBe(true)
    expect(await markReconciliationAbandoned(id, 'Exceeded MAX_ATTEMPTS')).toBe(
      true
    )
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.ABANDONED,
    })
    const pending = await getPendingReconciliations()
    expect(pending.some(entry => entry.id === id)).toBe(false)
  })

  it('a second worker loses the claim', async () => {
    const id = await insertEntry({
      correlationId: `corr-race-${RUN}`,
      username: `recrace${RUN.slice(0, 6)}`,
    })
    expect(await claimReconciliationEntry(id, 'worker-a')).toBe(true)
    expect(await claimReconciliationEntry(id, 'worker-b')).toBe(false)
  })
})
