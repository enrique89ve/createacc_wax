/**
 * Durable reconciliation worker. Importing this module does not start timers;
 * the production server bootstrap owns startup and shutdown.
 */

import { logger } from '@/lib/logger'
import {
  confirmPendingBroadcastedAccounts,
  recoverStaleCreationAttempts,
} from '@/lib/confirm-broadcasted'
import { reconcileCreationAttempt } from '@/lib/creation-reconciler'
import {
  processPendingRcDelegations,
  reconcileUncertainRcDelegations,
} from '@/lib/create/queue-rc-delegation'
import {
  getPendingReconciliations,
  claimReconciliationEntry,
  markReconciliationResolved,
  markReconciliationFailed,
  obfuscateTicket,
  type ReconciliationEntry,
} from '@/utils/db-ticket-validator'
import { RECONCILIATION_CONFIG } from '@/consts/constants'

const RESOLVER_ID = 'auto-reconciler'

let isRunning = false
let interval: ReturnType<typeof setInterval> | null = null
let activeCycle: Promise<void> | null = null

interface EntryMetrics {
  readonly claimed: number
  readonly completed: number
  readonly compensated: number
  readonly pendingEvidence: number
  readonly failed: number
  readonly manualReview: number
  readonly maximumAgeMs: number
}

interface MutableEntryMetrics {
  claimed: number
  completed: number
  compensated: number
  pendingEvidence: number
  failed: number
  manualReview: number
  maximumAgeMs: number
}

function emptyMetrics(): MutableEntryMetrics {
  return {
    claimed: 0,
    completed: 0,
    compensated: 0,
    pendingEvidence: 0,
    failed: 0,
    manualReview: 0,
    maximumAgeMs: 0,
  }
}

function recordOutcome(
  metrics: MutableEntryMetrics,
  result: EntryMetrics
): void {
  metrics.claimed += result.claimed
  metrics.completed += result.completed
  metrics.compensated += result.compensated
  metrics.pendingEvidence += result.pendingEvidence
  metrics.failed += result.failed
  metrics.manualReview += result.manualReview
  metrics.maximumAgeMs = Math.max(metrics.maximumAgeMs, result.maximumAgeMs)
}

async function reconcileEntry(
  entry: ReconciliationEntry
): Promise<EntryMetrics> {
  const { id, correlationId, ticketCode } = entry
  const ageMs = Math.max(0, Date.now() - Date.parse(entry.createdAt))
  const base = {
    claimed: 0,
    completed: 0,
    compensated: 0,
    pendingEvidence: 0,
    failed: 0,
    manualReview: 0,
    maximumAgeMs: ageMs,
  }
  let lease: Awaited<ReturnType<typeof claimReconciliationEntry>> = null

  try {
    lease = await claimReconciliationEntry(id, RESOLVER_ID)
    if (!lease) return base

    const claimed = { ...base, claimed: 1 }
    const obfuscated = obfuscateTicket(ticketCode)
    if (lease.attemptCount > RECONCILIATION_CONFIG.MAX_ATTEMPTS) {
      const marked = await markReconciliationFailed(
        lease,
        `Exceeded MAX_ATTEMPTS (${RECONCILIATION_CONFIG.MAX_ATTEMPTS}). Reserved ticket use remains held for review.`
      )
      if (!marked) return { ...claimed, failed: 1 }
      logger.error(
        `[${RESOLVER_ID}] [${correlationId}] Manual review required after retry budget. Ticket: ${obfuscated}`
      )
      return { ...claimed, manualReview: 1 }
    }

    const outcome = await reconcileCreationAttempt(correlationId)
    const isCompleted =
      outcome.kind === 'completed' ||
      (outcome.kind === 'already_terminal' && outcome.status === 'completed')
    const isRolledBack =
      outcome.kind === 'rolled_back' ||
      (outcome.kind === 'already_terminal' && outcome.status === 'rolled_back')

    if (isCompleted || isRolledBack) {
      const marked = await markReconciliationResolved(lease, RESOLVER_ID)
      if (!marked) return { ...claimed, failed: 1 }
      logger.info(
        `[${RESOLVER_ID}] [${correlationId}] Resolved as ${isCompleted ? 'completed' : 'rolled_back'}. Ticket: ${obfuscated}`
      )
      return {
        ...claimed,
        completed: isCompleted ? 1 : 0,
        compensated: isRolledBack ? 1 : 0,
      }
    }

    const detail =
      outcome.kind === 'pending' ||
      outcome.kind === 'review' ||
      outcome.kind === 'failed'
        ? outcome.reason
        : outcome.kind
    const marked = await markReconciliationFailed(lease, detail)
    if (!marked) return { ...claimed, failed: 1 }
    if (lease.attemptCount >= RECONCILIATION_CONFIG.MAX_ATTEMPTS) {
      logger.warn(
        `[${RESOLVER_ID}] [${correlationId}] Retry budget exhausted; reserved use remains in manual review: ${detail}`
      )
      return { ...claimed, manualReview: 1 }
    }
    if (outcome.kind === 'pending' || outcome.kind === 'review') {
      logger.info(
        `[${RESOLVER_ID}] [${correlationId}] Waiting for final Hive evidence: ${detail}`
      )
      return { ...claimed, pendingEvidence: 1 }
    }
    logger.warn(
      `[${RESOLVER_ID}] [${correlationId}] Reconciliation retry scheduled: ${detail}`
    )
    return { ...claimed, failed: 1 }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    let marked = false
    if (lease) {
      try {
        marked = await markReconciliationFailed(lease, detail)
      } catch {
        marked = false
      }
    }
    logger.error(
      `[${RESOLVER_ID}] [${correlationId}] Entry failed${lease ? (marked ? '; retry scheduled or manual review recorded' : '; lease no longer owns row') : '; claim unavailable'}: ${detail}`
    )
    const manualReview =
      marked && lease?.attemptCount === RECONCILIATION_CONFIG.MAX_ATTEMPTS
    return {
      ...base,
      claimed: lease ? 1 : 0,
      failed: marked && !manualReview ? 1 : 0,
      manualReview: manualReview ? 1 : 0,
    }
  }
}

async function runPhase<T>(
  phase: string,
  action: () => Promise<T>,
  onFailure: () => T
): Promise<T> {
  try {
    return await action()
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${RESOLVER_ID}] Phase '${phase}' failed: ${detail}`)
    return onFailure()
  }
}

async function runReconciliation(): Promise<void> {
  if (isRunning) return
  isRunning = true
  const startedAt = Date.now()
  let phaseErrors = 0
  let queueEntriesDue = 0
  const metrics = emptyMetrics()
  const runCountPhase = async (
    name: string,
    action: () => Promise<number>
  ): Promise<void> => {
    await runPhase(
      name,
      async () => action(),
      () => {
        phaseErrors += 1
        return 0
      }
    )
  }

  try {
    await runCountPhase(
      'confirm-broadcasted',
      confirmPendingBroadcastedAccounts
    )
    await runCountPhase('recover-stale-attempts', recoverStaleCreationAttempts)
    await runCountPhase(
      'reconcile-uncertain-rc',
      reconcileUncertainRcDelegations
    )
    await runCountPhase('process-rc-queue', processPendingRcDelegations)

    const pending = await runPhase(
      'read-queue',
      getPendingReconciliations,
      () => {
        phaseErrors += 1
        return []
      }
    )
    const now = Date.now()
    const mature = pending.filter(entry => {
      const createdAt = Date.parse(entry.createdAt)
      return (
        Number.isFinite(createdAt) &&
        now - createdAt >= RECONCILIATION_CONFIG.MIN_ENTRY_AGE_MS
      )
    })
    queueEntriesDue = mature.length

    for (const entry of mature) {
      recordOutcome(metrics, await reconcileEntry(entry))
      await new Promise(resolve =>
        setTimeout(resolve, RECONCILIATION_CONFIG.RATE_LIMIT_DELAY_MS)
      )
    }
  } finally {
    const durationMs = Date.now() - startedAt
    const cycle = {
      status: phaseErrors === 0 ? 'success' : 'partial',
      startedAt: new Date(startedAt).toISOString(),
      durationMs,
      phaseErrors,
      queueEntriesDue,
      ...metrics,
    }
    logger.info(`[${RESOLVER_ID}] Cycle ${JSON.stringify(cycle)}`)
    isRunning = false
  }
}

export function startAutoReconciler(): void {
  if (interval) return
  const launchCycle = (): void => {
    if (isRunning) return
    const trackedCycle = runReconciliation().then(
      () => {
        if (activeCycle === trackedCycle) activeCycle = null
      },
      error => {
        const detail = error instanceof Error ? error.message : 'Unknown error'
        logger.error(
          `[${RESOLVER_ID}] Cycle escaped its error boundary: ${detail}`
        )
        if (activeCycle === trackedCycle) activeCycle = null
      }
    )
    activeCycle = trackedCycle
  }
  launchCycle()
  interval = setInterval(
    launchCycle,
    RECONCILIATION_CONFIG.AUTO_CHECK_INTERVAL_MS
  )
  interval.unref()
  logger.info(
    `[${RESOLVER_ID}] Started (interval: ${RECONCILIATION_CONFIG.AUTO_CHECK_INTERVAL_MS / 1000}s).`
  )
}

export async function stopAutoReconciler(): Promise<void> {
  if (interval) {
    clearInterval(interval)
    interval = null
  }
  const cycle = activeCycle
  if (cycle) await cycle.catch(() => undefined)
  logger.info(`[${RESOLVER_ID}] Stopped.`)
}
