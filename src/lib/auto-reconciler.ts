/**
 * Automatic reconciliation service.
 *
 * Periodically checks for pending reconciliation entries and resolves them
 * using the same logic as the manual script (scripts/reconcile-pending.ts).
 *
 * Started as a side-effect import from middleware.ts (and account.ts for
 * belt-and-suspenders). ES module imports are idempotent — setInterval
 * is only created once even with multiple import sites.
 *
 * Uses setInterval(...).unref() to avoid blocking process shutdown.
 *
 * Safe for multi-instance deployments: each entry is atomically claimed via
 * claimReconciliationEntry (WHERE status IN ('pending','failed')) before any
 * credit mutation, so only one worker performs the rollback/complete per entry.
 * If the mutation fails post-claim, the entry is marked 'failed' and retried
 * in the next cycle (up to MAX_ATTEMPTS, then abandoned).
 */

import { logger } from '@/lib/logger'
import { hiveChain } from '@/lib/hiveservice'
import { validateHiveAccountExistsWithPolling } from '@/utils/validate-hiveuser'
import { recoverOwnedAccount } from '@/lib/recover-owned-account'
import { getCreationAttempt } from '@/lib/creation-attempts'
import {
  confirmPendingBroadcastedAccounts,
  persistHiveMatchedAccount,
  recoverStaleCreationAttempts,
} from '@/lib/confirm-broadcasted'
import { reconcileUncertainRcDelegations } from '@/lib/create/queue-rc-delegation'
import {
  getPendingReconciliations,
  claimReconciliationEntry,
  markReconciliationResolved,
  markReconciliationFailed,
  markReconciliationAbandoned,
  resetStuckProcessingEntries,
  rollbackTicketReservation,
  accountExistsInDB,
  obfuscateTicket,
  type ReconciliationEntry,
} from '@/utils/db-ticket-validator'
import { RECONCILIATION_CONFIG } from '@/consts/constants'

const RESOLVER_ID = 'auto-reconciler'

let isRunning = false

async function reconcileEntry(
  entry: ReconciliationEntry,
  chain: Awaited<ReturnType<typeof hiveChain>>
): Promise<void> {
  const { id, correlationId, username, ticketCode, reason, attemptCount } =
    entry
  const obfuscated = obfuscateTicket(ticketCode)
  let claimed = false

  try {
    // 1. Atomically claim entry BEFORE any reconciliation mutation
    claimed = await claimReconciliationEntry(id, RESOLVER_ID)
    if (!claimed) {
      logger.info(
        `[${RESOLVER_ID}] [${correlationId}] Already claimed by another worker. Skipping.`
      )
      return
    }

    // 2. Entries over retry budget become terminal (abandoned)
    if (attemptCount >= RECONCILIATION_CONFIG.MAX_ATTEMPTS) {
      const abandonMessage = `Exceeded MAX_ATTEMPTS (${RECONCILIATION_CONFIG.MAX_ATTEMPTS}). Last known attempts before claim: ${attemptCount}.`
      const abandoned = await markReconciliationAbandoned(id, abandonMessage)
      if (!abandoned) {
        logger.error(
          `[${RESOLVER_ID}] [${correlationId}] Failed to mark entry #${id} as abandoned after claim.`
        )
      } else {
        logger.error(
          `[${RESOLVER_ID}] [${correlationId}] Entry #${id} moved to abandoned after exhausting retries. Ticket: ${obfuscated}`
        )
      }
      return
    }

    // 3. Poll chain confirmation before any rollback decision
    const chainResult = await validateHiveAccountExistsWithPolling({
      chain,
      accountName: username,
    })

    if (chainResult.status === 'error') {
      await markReconciliationFailed(
        id,
        `Chain polling error after ${chainResult.attempts} attempt(s): ${chainResult.message}`
      )
      logger.warn(
        `[${RESOLVER_ID}] [${correlationId}] Chain polling failed for ${username} after ${chainResult.attempts} attempt(s)${chainResult.timedOut ? ' (timed out)' : ''}: ${chainResult.message}. Marked as failed (will retry).`
      )
      return
    }

    // 4. Resolve from confirmed on-chain state
    if (chainResult.status === 'found') {
      const existsInDB = await accountExistsInDB(username)
      const attempt = await getCreationAttempt(correlationId)
      if (!attempt) {
        await markReconciliationFailed(
          id,
          'No creation attempt for correlation'
        )
        return
      }

      const recovered = await recoverOwnedAccount({
        username,
        ticket: ticketCode,
        keys: attempt.keys,
        correlationId,
      })

      if (recovered.kind !== 'recovered') {
        if (recovered.kind === 'foreign_account') {
          const rollbackResult = await rollbackTicketReservation(
            ticketCode,
            correlationId
          )
          if (!rollbackResult.success) {
            await markReconciliationFailed(
              id,
              `Rollback failed: ${rollbackResult.error}`
            )
            return
          }
          await markReconciliationResolved(id, RESOLVER_ID)
          logger.info(
            `[${RESOLVER_ID}] [${correlationId}] Foreign Hive account for ${username}. Rolled back this attempt.`
          )
          return
        }
        await markReconciliationFailed(id, `Recovery was ${recovered.kind}`)
        return
      }

      const persisted = await persistHiveMatchedAccount({
        username,
        ticket: ticketCode,
        correlationId,
        attempt,
      })
      if (!persisted) {
        await markReconciliationFailed(id, 'Hive-matched persist failed')
        return
      }
      await markReconciliationResolved(id, RESOLVER_ID)
      logger.info(
        `[${RESOLVER_ID}] [${correlationId}] Confirmed owned Hive account ${username} (existsInDB=${existsInDB}). Ticket: ${obfuscated}`
      )
      return
    }

    // 5. status='not_found' is the only branch allowed to rollback credits
    const rollbackResult = await rollbackTicketReservation(
      ticketCode,
      correlationId
    )
    if (!rollbackResult.success) {
      await markReconciliationFailed(
        id,
        `Rollback failed: ${rollbackResult.error}`
      )
      logger.error(
        `[${RESOLVER_ID}] [${correlationId}] Rollback failed: ${rollbackResult.error}. Ticket: ${obfuscated}. Marked as failed (will retry).`
      )
    } else {
      await markReconciliationResolved(id, RESOLVER_ID)
      logger.info(
        `[${RESOLVER_ID}] [${correlationId}] Rolled back ticket ${obfuscated} (reason: ${reason}).`
      )
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    // Best-effort: mark as failed only if this worker claimed the entry
    let statusNote = 'Entry was not claimed; no status update applied.'
    if (claimed) {
      try {
        const marked = await markReconciliationFailed(id, errMsg)
        statusNote = marked
          ? 'Marked as failed.'
          : 'Failed to mark as failed after claim.'
      } catch {
        // If even marking failed fails, just log it
        statusNote = 'Failed to mark as failed after claim.'
      }
    }
    logger.error(
      `[${RESOLVER_ID}] [${correlationId}] Error processing entry: ${errMsg}. ${statusNote}`
    )
  }
}

async function runReconciliation(): Promise<void> {
  if (isRunning) return
  isRunning = true

  try {
    // Reset entries stuck in 'processing' (crashed workers)
    const resetCount = await resetStuckProcessingEntries(
      RECONCILIATION_CONFIG.PROCESSING_TIMEOUT_MS
    )
    if (resetCount > 0) {
      logger.warn(
        `[${RESOLVER_ID}] Reset ${resetCount} stuck processing entry/entries to 'failed'.`
      )
    }

    const confirmed = await confirmPendingBroadcastedAccounts()
    if (confirmed > 0) {
      logger.info(
        `[${RESOLVER_ID}] Confirmed ${confirmed} broadcasted account(s) and queued RC once.`
      )
    }
    const stale = await recoverStaleCreationAttempts()
    if (stale > 0) {
      logger.info(
        `[${RESOLVER_ID}] Reclaimed ${stale} stale creation attempt(s).`
      )
    }
    const rcResolved = await reconcileUncertainRcDelegations()
    if (rcResolved > 0) {
      logger.info(
        `[${RESOLVER_ID}] Resolved ${rcResolved} uncertain RC delegation(s).`
      )
    }

    const pending = await getPendingReconciliations()
    if (pending.length === 0) return

    // Filter to only process entries older than MIN_ENTRY_AGE_MS
    const now = Date.now()
    const mature = pending.filter(entry => {
      const createdAt = new Date(entry.createdAt).getTime()
      return now - createdAt >= RECONCILIATION_CONFIG.MIN_ENTRY_AGE_MS
    })

    if (mature.length === 0) return

    logger.info(
      `[${RESOLVER_ID}] Processing ${mature.length} pending reconciliation(s).`
    )

    const chain = await hiveChain()

    for (const entry of mature) {
      await reconcileEntry(entry, chain)
      // Small delay between entries to avoid hammering the API
      await new Promise(resolve =>
        setTimeout(resolve, RECONCILIATION_CONFIG.RATE_LIMIT_DELAY_MS)
      )
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[${RESOLVER_ID}] Run failed: ${errMsg}`)
  } finally {
    isRunning = false
  }
}

// Start the automatic reconciliation interval (does not block process exit)
const interval = setInterval(
  runReconciliation,
  RECONCILIATION_CONFIG.AUTO_CHECK_INTERVAL_MS
)
interval.unref()

logger.info(
  `[${RESOLVER_ID}] Started (interval: ${RECONCILIATION_CONFIG.AUTO_CHECK_INTERVAL_MS / 1000}s).`
)
