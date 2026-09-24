/**
 * Reconciliation consumer for ambiguous account creation operations.
 *
 * Reads pending entries from ReconciliationQueue, checks on-chain state,
 * and resolves each entry:
 *
 * - If account exists on-chain AND in DB → already reconciled, mark resolved.
 * - If account exists on-chain but NOT in DB → complete DB operations, mark resolved.
 * - If account does NOT exist on-chain → rollback the ticket credit, mark resolved.
 * - If mutation fails post-claim → mark failed (retryable in next cycle).
 *
 * Usage:
 *   pnpm tsx scripts/reconcile-pending.ts
 *   pnpm tsx scripts/reconcile-pending.ts --dry-run
 *   pnpm tsx scripts/reconcile-pending.ts --review <correlation-id> --operator <id>
 *   pnpm tsx scripts/reconcile-pending.ts --dry-run --review <correlation-id>
 */

import { initializeDatabase } from '@/lib/database'
import {
  getPendingReconciliations,
  claimReconciliationEntry,
  getManualReviewReconciliation,
  claimManualReviewReconciliation,
  markReconciliationResolved,
  markReconciliationFailed,
  releaseManualReviewReconciliation,
  obfuscateTicket,
  type ReconciliationEntry,
} from '@/utils/db-ticket-validator'
import { reconcileCreationAttempt } from '@/lib/creation-reconciler'
import { RECONCILIATION_CONFIG } from '@/consts/constants'

const RESOLVER_ID = 'reconcile-script'
const cliArguments = process.argv.slice(2)
const isDryRun = cliArguments.includes('--dry-run')

function readOption(option: string): string | undefined {
  const index = cliArguments.indexOf(option)
  if (index === -1) return undefined
  const value = cliArguments[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${option}`)
  }
  return value
}

const reviewCorrelationId = readOption('--review')
const operatorId = readOption('--operator')

interface ReconciliationResult {
  readonly entryId: number
  readonly correlationId: string
  readonly username: string
  readonly action:
    | 'completed_db'
    | 'rolled_back'
    | 'already_consistent'
    | 'manual_review'
    | 'error'
  readonly detail: string
}

async function reconcileEntry(
  entry: ReconciliationEntry,
  options: { readonly manualReview: boolean; readonly operatorId?: string }
): Promise<ReconciliationResult> {
  const { id, correlationId, username, ticketCode } = entry
  const obfuscated = obfuscateTicket(ticketCode)
  const resolutionActor = options.operatorId ?? RESOLVER_ID
  let lease: Awaited<ReturnType<typeof claimReconciliationEntry>> = null

  try {
    if (!isDryRun) {
      lease = options.manualReview
        ? await claimManualReviewReconciliation(id, options.operatorId ?? '')
        : await claimReconciliationEntry(id, RESOLVER_ID)
      if (!lease) {
        return {
          entryId: id,
          correlationId,
          username,
          action: 'already_consistent',
          detail: 'Already claimed by another worker. Skipped.',
        }
      }
    }

    if (
      !options.manualReview &&
      lease &&
      lease.attemptCount > RECONCILIATION_CONFIG.MAX_ATTEMPTS
    ) {
      const detail =
        'Exceeded MAX_ATTEMPTS (' +
        RECONCILIATION_CONFIG.MAX_ATTEMPTS +
        '); reserved use remains held for review. Ticket: ' +
        obfuscated
      await markReconciliationFailed(lease, detail)
      return {
        entryId: id,
        correlationId,
        username,
        action: 'manual_review',
        detail:
          (isDryRun
            ? 'Would require manual review. '
            : 'Requires manual review. ') + detail,
      }
    }

    const outcome = await reconcileCreationAttempt(correlationId, {
      dryRun: isDryRun,
    })
    if (outcome.kind === 'completed' || outcome.kind === 'would_complete') {
      if (lease) await markReconciliationResolved(lease, resolutionActor)
      return {
        entryId: id,
        correlationId,
        username,
        action: 'completed_db',
        detail:
          (isDryRun ? 'Would complete' : 'Completed') +
          ' from irreversible transaction evidence. Ticket: ' +
          obfuscated,
      }
    }
    if (outcome.kind === 'rolled_back' || outcome.kind === 'would_rollback') {
      if (lease) await markReconciliationResolved(lease, resolutionActor)
      return {
        entryId: id,
        correlationId,
        username,
        action: 'rolled_back',
        detail:
          (isDryRun ? 'Would restore' : 'Restored') +
          ' the ticket use after definitive non-execution. Ticket: ' +
          obfuscated,
      }
    }
    if (outcome.kind === 'already_terminal') {
      if (lease) await markReconciliationResolved(lease, resolutionActor)
      return {
        entryId: id,
        correlationId,
        username,
        action: 'already_consistent',
        detail:
          'Attempt is already ' + outcome.status + '. Ticket: ' + obfuscated,
      }
    }

    const detail =
      outcome.kind === 'pending' ||
      outcome.kind === 'review' ||
      outcome.kind === 'failed'
        ? outcome.reason
        : outcome.kind
    if (options.manualReview) {
      if (lease) await releaseManualReviewReconciliation(lease, detail)
      return {
        entryId: id,
        correlationId,
        username,
        action: 'manual_review',
        detail:
          detail +
          '. ' +
          (isDryRun
            ? 'The item remains in manual review; no database changes were made.'
            : 'The item remains in manual review.') +
          ' Ticket: ' +
          obfuscated,
      }
    }
    if (lease) await markReconciliationFailed(lease, detail)
    return {
      entryId: id,
      correlationId,
      username,
      action: 'error',
      detail:
        detail +
        '. ' +
        (isDryRun
          ? 'No database changes were made.'
          : 'Marked for retry/review.') +
        ' Ticket: ' +
        obfuscated,
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    if (options.manualReview) {
      if (lease) await releaseManualReviewReconciliation(lease, detail)
      return {
        entryId: id,
        correlationId,
        username,
        action: 'manual_review',
        detail:
          detail +
          (isDryRun
            ? '. Item remains in manual review; no database changes were made.'
            : '. Item remains in manual review.'),
      }
    }
    if (lease) await markReconciliationFailed(lease, detail)
    return {
      entryId: id,
      correlationId,
      username,
      action: 'error',
      detail:
        detail +
        '. ' +
        (isDryRun ? 'No database changes were made.' : 'Marked for retry.'),
    }
  }
}

async function main() {
  if (operatorId && !reviewCorrelationId) {
    throw new Error('--operator can only be used together with --review')
  }
  if (reviewCorrelationId && !isDryRun && !operatorId) {
    throw new Error('--operator is required for a live manual review')
  }

  console.log(
    `--- ${reviewCorrelationId ? 'Manual Evidence Review' : 'Reconciliation Consumer'} ${isDryRun ? '(DRY RUN)' : ''} ---`
  )

  await initializeDatabase()

  const manualReviewEntry = reviewCorrelationId
    ? await getManualReviewReconciliation(reviewCorrelationId)
    : null
  const pending = reviewCorrelationId
    ? manualReviewEntry
      ? [manualReviewEntry]
      : []
    : await getPendingReconciliations()
  console.log(
    reviewCorrelationId
      ? pending.length > 0
        ? 'Found the requested unresolved manual-review item.'
        : 'No unresolved manual-review item found for that correlation ID.'
      : `Found ${pending.length} pending reconciliation(s).`
  )

  if (pending.length === 0) {
    console.log('Nothing to reconcile.')
    return
  }

  const results: ReconciliationResult[] = []

  for (const entry of pending) {
    const result = await reconcileEntry(entry, {
      manualReview: reviewCorrelationId !== undefined,
      operatorId,
    })
    results.push(result)
    console.log(`[${result.correlationId}] ${result.action}: ${result.detail}`)

    // Small delay between entries to avoid hammering the API
    await new Promise(r =>
      setTimeout(r, RECONCILIATION_CONFIG.RATE_LIMIT_DELAY_MS)
    )
  }

  // Summary
  const summary = {
    total: results.length,
    completedDb: results.filter(r => r.action === 'completed_db').length,
    rolledBack: results.filter(r => r.action === 'rolled_back').length,
    alreadyConsistent: results.filter(r => r.action === 'already_consistent')
      .length,
    manualReview: results.filter(r => r.action === 'manual_review').length,
    errors: results.filter(r => r.action === 'error').length,
  }

  console.log('\n--- Summary ---')
  console.log(`Total:              ${summary.total}`)
  console.log(`Completed DB:       ${summary.completedDb}`)
  console.log(`Rolled back:        ${summary.rolledBack}`)
  console.log(`Already consistent: ${summary.alreadyConsistent}`)
  console.log(`Manual review:      ${summary.manualReview}`)
  console.log(`Errors:             ${summary.errors}`)

  if (summary.errors > 0 || summary.manualReview > 0) {
    console.error(
      '\nSome entries need retry or manual review. Review logs above.'
    )
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Reconciliation failed:', error)
  process.exit(1)
})
