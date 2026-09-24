import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initializeDatabase, db } from '@/lib/database'
import {
  RECONCILIATION_CONFIG,
  RECONCILIATION_STATUS,
} from '@/consts/constants'
import { HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'
import {
  claimReconciliationEntry,
  claimManualReviewReconciliation,
  getPendingReconciliations,
  getManualReviewReconciliation,
  markReconciliationFailed,
  markReconciliationResolved,
  releaseManualReviewReconciliation,
  enqueueReconciliation,
} from '@/utils/db-ticket-validator'

const RUN = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
const TICKET = `RECON${RUN.toUpperCase()}`
const RESOLVER = 'vitest-reconciliation'

async function insertEntry(params: {
  readonly correlationId: string
  readonly username: string
  readonly status?: string
  readonly attemptCount?: number
  readonly leaseExpiresAtSql?: string
}): Promise<number> {
  const result = await db.execute({
    sql: `INSERT INTO ReconciliationQueue (
			correlation_id, username, ticket_code, reason, status, attempt_count,
      processing_since, lease_token, lease_expires_at, lease_generation
		) VALUES (?, ?, ?, 'ambiguous_chain_error', ?, ?, ${params.leaseExpiresAtSql ? 'CURRENT_TIMESTAMP' : 'NULL'},
      ${params.status === RECONCILIATION_STATUS.PROCESSING ? `'old-worker-${params.correlationId}'` : 'NULL'},
      ${params.leaseExpiresAtSql ?? 'NULL'},
      ${params.status === RECONCILIATION_STATUS.PROCESSING ? '1' : '0'})
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
  readonly resolved: boolean
  readonly leaseToken: string | null
  readonly leaseGeneration: number
  readonly nextAttemptAt: string
  readonly resolvedBy: string | null
}> {
  const result = await db.execute({
    sql: `SELECT status, attempt_count, resolved, resolved_by, lease_token, lease_generation,
                 next_attempt_at FROM ReconciliationQueue WHERE id = ?`,
    args: [id],
  })
  return {
    status: String(result.rows[0]?.status),
    attemptCount: Number(result.rows[0]?.attempt_count),
    resolved: Boolean(result.rows[0]?.resolved),
    leaseToken: result.rows[0]?.lease_token as string | null,
    leaseGeneration: Number(result.rows[0]?.lease_generation),
    nextAttemptAt: String(result.rows[0]?.next_attempt_at),
    resolvedBy: result.rows[0]?.resolved_by as string | null,
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
  it('claims and resolves with a token-fenced lease', async () => {
    const id = await insertEntry({
      correlationId: `corr-ok-${RUN}`,
      username: `recok${RUN.slice(0, 8)}`,
    })
    const lease = await claimReconciliationEntry(id, RESOLVER)
    expect(lease).toMatchObject({ id, generation: 1, attemptCount: 1 })
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.PROCESSING,
      attemptCount: 1,
      leaseGeneration: 1,
    })
    expect(lease).not.toBeNull()
    expect(await markReconciliationResolved(lease!, RESOLVER)).toBe(true)
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.RESOLVED,
      resolved: true,
      leaseToken: null,
    })
    const pending = await getPendingReconciliations()
    expect(pending.some(entry => entry.id === id)).toBe(false)
  })

  it('failed → retry claim', async () => {
    const id = await insertEntry({
      correlationId: `corr-retry-${RUN}`,
      username: `retry${RUN.slice(0, 8)}`,
    })
    const firstLease = await claimReconciliationEntry(id, RESOLVER)
    expect(firstLease).not.toBeNull()
    expect(
      await markReconciliationFailed(firstLease!, 'simulated failure')
    ).toBe(true)
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.FAILED,
      resolved: false,
      leaseToken: null,
    })
    expect(await claimReconciliationEntry(id, RESOLVER)).toBeNull()
    await db.execute({
      sql: `UPDATE ReconciliationQueue SET next_attempt_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [id],
    })
    const secondLease = await claimReconciliationEntry(id, RESOLVER)
    expect(secondLease).toMatchObject({ generation: 2, attemptCount: 2 })
    expect(await markReconciliationResolved(firstLease!, RESOLVER)).toBe(false)
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.PROCESSING,
      attemptCount: 2,
      leaseGeneration: 2,
    })
  })

  it('an expired lease is transferred and fences the previous worker', async () => {
    const id = await insertEntry({
      correlationId: `corr-stale-${RUN}`,
      username: `stale${RUN.slice(0, 8)}`,
      status: RECONCILIATION_STATUS.PROCESSING,
      attemptCount: 1,
      leaseExpiresAtSql: `datetime('now', '-10 minutes')`,
    })
    const priorLease = {
      id,
      token: `old-worker-corr-stale-${RUN}`,
      generation: 1,
      attemptCount: 1,
    }
    const takeover = await claimReconciliationEntry(id, RESOLVER)
    expect(takeover).toMatchObject({ id, generation: 2, attemptCount: 2 })
    expect(await markReconciliationFailed(priorLease, 'stale worker')).toBe(
      false
    )
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.PROCESSING,
      leaseGeneration: 2,
    })
  })

  it('exhausted retries stay unresolved in manual review', async () => {
    const id = await insertEntry({
      correlationId: `corr-max-${RUN}`,
      username: `recmax${RUN.slice(0, 7)}`,
      status: RECONCILIATION_STATUS.FAILED,
      attemptCount: RECONCILIATION_CONFIG.MAX_ATTEMPTS - 1,
    })
    const before = await statusOf(id)
    expect(before.attemptCount).toBe(RECONCILIATION_CONFIG.MAX_ATTEMPTS - 1)
    const lease = await claimReconciliationEntry(id, RESOLVER)
    expect(lease?.attemptCount).toBe(RECONCILIATION_CONFIG.MAX_ATTEMPTS)
    expect(
      await markReconciliationFailed(lease!, 'Exceeded MAX_ATTEMPTS')
    ).toBe(true)
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.MANUAL_REVIEW,
      resolved: false,
      leaseToken: null,
    })
    const pending = await getPendingReconciliations()
    expect(pending.some(entry => entry.id === id)).toBe(false)
    expect(
      await getManualReviewReconciliation(`corr-max-${RUN}`)
    ).toMatchObject({
      id,
      status: RECONCILIATION_STATUS.MANUAL_REVIEW,
    })
  })

  it('manual evidence review is operator-claimed and stays manual when inconclusive', async () => {
    const id = await insertEntry({
      correlationId: `corr-manual-${RUN}`,
      username: `manual${RUN.slice(0, 8)}`,
      status: RECONCILIATION_STATUS.MANUAL_REVIEW,
      attemptCount: RECONCILIATION_CONFIG.MAX_ATTEMPTS,
    })
    await expect(claimManualReviewReconciliation(id, '   ')).rejects.toThrow(
      'A valid operator identity is required'
    )

    const lease = await claimManualReviewReconciliation(id, ' operator-42 ')
    expect(lease).toMatchObject({
      id,
      generation: 1,
      attemptCount: RECONCILIATION_CONFIG.MAX_ATTEMPTS + 1,
    })
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.PROCESSING,
      resolved: false,
      resolvedBy: 'operator-42',
    })
    expect(
      await releaseManualReviewReconciliation(
        lease!,
        'Evidence still uncertain'
      )
    ).toBe(true)
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.MANUAL_REVIEW,
      resolved: false,
      leaseToken: null,
      resolvedBy: 'operator-42',
    })
    expect(
      (await getPendingReconciliations()).some(entry => entry.id === id)
    ).toBe(false)

    const secondLease = await claimManualReviewReconciliation(id, 'operator-42')
    expect(secondLease).toMatchObject({ generation: 2 })
    expect(await markReconciliationResolved(secondLease!, 'operator-42')).toBe(
      true
    )
    expect(await statusOf(id)).toMatchObject({
      status: RECONCILIATION_STATUS.RESOLVED,
      resolved: true,
      resolvedBy: 'operator-42',
    })
  })

  it('a second worker loses the claim', async () => {
    const id = await insertEntry({
      correlationId: `corr-race-${RUN}`,
      username: `recrace${RUN.slice(0, 6)}`,
    })
    expect(await claimReconciliationEntry(id, 'worker-a')).not.toBeNull()
    expect(await claimReconciliationEntry(id, 'worker-b')).toBeNull()
  })

  it('enqueue is idempotent by correlation ID', async () => {
    const correlationId = `corr-unique-${RUN}`
    await enqueueReconciliation({
      correlationId,
      username: `unique${RUN.slice(0, 8)}`,
      ticketCode: TICKET,
      reason: 'ambiguous_chain_error',
      executionMode: HIVE_TX_MODE_VALUES.BROADCAST,
      errorMessage: 'first observation',
    })
    await enqueueReconciliation({
      correlationId,
      username: `unique${RUN.slice(0, 8)}`,
      ticketCode: TICKET,
      reason: 'ambiguous_chain_error',
      executionMode: HIVE_TX_MODE_VALUES.BROADCAST,
      errorMessage: 'updated observation',
    })
    const result = await db.execute({
      sql: `SELECT id, last_error FROM ReconciliationQueue WHERE correlation_id = ?`,
      args: [correlationId],
    })
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.last_error).toBe('updated observation')
  })
})
