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
 */

import { initializeDatabase } from '@/lib/database'
import {
  getPendingReconciliations,
  claimReconciliationEntry,
  markReconciliationResolved,
  markReconciliationFailed,
  markReconciliationAbandoned,
  resetStuckProcessingEntries,
  rollbackTicketReservation,
  obfuscateTicket,
} from '@/utils/db-ticket-validator'
import { hiveChain } from '@/lib/hiveservice'
import { validateHiveAccountExistsWithPolling } from '@/utils/validate-hiveuser'
import { recoverOwnedAccount } from '@/lib/recover-owned-account'
import { getCreationAttempt } from '@/lib/creation-attempts'
import { persistHiveMatchedAccount } from '@/lib/confirm-broadcasted'
import { RECONCILIATION_CONFIG } from '@/consts/constants'

const RESOLVER_ID = 'reconcile-script'
const isDryRun = process.argv.includes('--dry-run')

interface ReconciliationResult {
  readonly entryId: number
  readonly correlationId: string
  readonly username: string
  readonly action:
    | 'completed_db'
    | 'rolled_back'
    | 'already_consistent'
    | 'abandoned'
    | 'error'
  readonly detail: string
}

async function reconcileEntry(
  entry: Awaited<ReturnType<typeof getPendingReconciliations>>[number],
  chain: Awaited<ReturnType<typeof hiveChain>>
): Promise<ReconciliationResult> {
  const { id, correlationId, username, ticketCode, reason, attemptCount } =
    entry
  const obfuscated = obfuscateTicket(ticketCode)
  let claimed = false

  try {
    // Step 1: In non-dry-run mode, claim entry before any state transition.
    if (!isDryRun) {
      claimed = await claimReconciliationEntry(id, RESOLVER_ID)
      if (!claimed) {
        return {
          entryId: id,
          correlationId,
          username,
          action: 'already_consistent',
          detail: `Already claimed by another worker. Skipped.`,
        }
      }
    }

    // Step 2: Entries over retry budget move to abandoned terminal state.
    if (attemptCount >= RECONCILIATION_CONFIG.MAX_ATTEMPTS) {
      const detail = `Exceeded MAX_ATTEMPTS (${RECONCILIATION_CONFIG.MAX_ATTEMPTS}). Last known attempts before claim: ${attemptCount}. Ticket: ${obfuscated}`
      if (isDryRun) {
        return {
          entryId: id,
          correlationId,
          username,
          action: 'abandoned',
          detail: `Would mark as abandoned. ${detail}`,
        }
      }

      const abandoned = await markReconciliationAbandoned(id, detail)
      if (!abandoned) {
        return {
          entryId: id,
          correlationId,
          username,
          action: 'error',
          detail: `Failed to mark as abandoned after claim. Ticket: ${obfuscated}`,
        }
      }

      return {
        entryId: id,
        correlationId,
        username,
        action: 'abandoned',
        detail: `Marked as abandoned. ${detail}`,
      }
    }

    // Step 3: Poll on-chain state before deciding rollback.
    const chainResult = await validateHiveAccountExistsWithPolling({
      chain,
      accountName: username,
    })

    if (chainResult.status === 'error') {
      if (!isDryRun) {
        await markReconciliationFailed(
          id,
          `Chain polling error after ${chainResult.attempts} attempt(s): ${chainResult.message}`
        )
      }
      return {
        entryId: id,
        correlationId,
        username,
        action: 'error',
        detail: `Chain polling failed after ${chainResult.attempts} attempt(s)${chainResult.timedOut ? ' (timed out)' : ''}: ${chainResult.message}. ${isDryRun ? '' : 'Marked as failed (will retry).'} Ticket: ${obfuscated}`,
      }
    }

    // Step 4: status='found' path resolves consistency or DB completion.
    if (chainResult.status === 'found') {
      const attempt = await getCreationAttempt(correlationId)
      if (!attempt) {
        if (!isDryRun) {
          await markReconciliationFailed(
            id,
            'No creation attempt for correlation'
          )
        }
        return {
          entryId: id,
          correlationId,
          username,
          action: 'error',
          detail: `No creation attempt for ${correlationId}. Ticket: ${obfuscated}`,
        }
      }

      const recovered = await recoverOwnedAccount({
        username,
        ticket: ticketCode,
        keys: attempt.keys,
        correlationId,
      })

      if (recovered.kind !== 'recovered') {
        if (recovered.kind === 'foreign_account') {
          if (!isDryRun) {
            const rollbackResult = await rollbackTicketReservation(
              correlationId
            )
            if (!rollbackResult.success) {
              await markReconciliationFailed(
                id,
                `Rollback failed: ${rollbackResult.error}`
              )
              return {
                entryId: id,
                correlationId,
                username,
                action: 'error',
                detail: `Rollback failed after foreign account. Ticket: ${obfuscated}`,
              }
            }
            await markReconciliationResolved(id, RESOLVER_ID)
          }
          return {
            entryId: id,
            correlationId,
            username,
            action: 'rolled_back',
            detail: `Hive account authorities do not match this attempt. ${isDryRun ? 'Would roll back' : 'Rolled back'} this credit. Ticket: ${obfuscated}`,
          }
        }
        if (!isDryRun) {
          await markReconciliationFailed(id, `Recovery was ${recovered.kind}`)
        }
        return {
          entryId: id,
          correlationId,
          username,
          action: 'error',
          detail: `Could not recover owned account (${recovered.kind}). Ticket: ${obfuscated}`,
        }
      }

      if (!isDryRun) {
        const persisted = await persistHiveMatchedAccount(attempt)
        if (!persisted) {
          await markReconciliationFailed(id, 'Hive-matched persist failed')
          return {
            entryId: id,
            correlationId,
            username,
            action: 'error',
            detail: `Hive-matched persist failed. Ticket: ${obfuscated}`,
          }
        }
        await markReconciliationResolved(id, RESOLVER_ID)
      }
      return {
        entryId: id,
        correlationId,
        username,
        action: 'completed_db',
        detail: `Owned account on-chain but not in DB. ${isDryRun ? 'Would complete' : 'Completed'} DB operations. Ticket: ${obfuscated}`,
      }
    }

    // Step 5: status='not_found' is the only branch that can rollback credits.
    if (!isDryRun) {
      const rollbackResult = await rollbackTicketReservation(
        correlationId
      )
      if (!rollbackResult.success) {
        await markReconciliationFailed(
          id,
          `Rollback failed: ${rollbackResult.error}`
        )
        return {
          entryId: id,
          correlationId,
          username,
          action: 'error',
          detail: `Rollback failed: ${rollbackResult.error}. Ticket: ${obfuscated}. Marked as failed (will retry).`,
        }
      }
      await markReconciliationResolved(id, RESOLVER_ID)
    }
    return {
      entryId: id,
      correlationId,
      username,
      action: 'rolled_back',
      detail: `Account not on-chain (reason: ${reason}). ${isDryRun ? 'Would rollback' : 'Rolled back'} ticket ${obfuscated}.`,
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    // Best-effort: mark as failed if not dry-run
    let statusNote = isDryRun
      ? ''
      : 'Entry was not claimed; no status update applied.'
    if (!isDryRun && claimed) {
      try {
        const marked = await markReconciliationFailed(id, errMsg)
        statusNote = marked
          ? 'Marked as failed (will retry).'
          : 'Failed to mark as failed after claim.'
      } catch {
        // If marking failed also fails, just report it
        statusNote = 'Failed to mark as failed after claim.'
      }
    }
    return {
      entryId: id,
      correlationId,
      username,
      action: 'error',
      detail: `Error processing: ${errMsg}. ${statusNote}`,
    }
  }
}

async function main() {
  console.log(`--- Reconciliation Consumer ${isDryRun ? '(DRY RUN)' : ''} ---`)

  await initializeDatabase()

  // Reset stuck processing entries before starting
  if (!isDryRun) {
    const resetCount = await resetStuckProcessingEntries(
      RECONCILIATION_CONFIG.PROCESSING_TIMEOUT_MS
    )
    if (resetCount > 0) {
      console.log(
        `Reset ${resetCount} stuck processing entry/entries to 'failed'.`
      )
    }
  }

  const pending = await getPendingReconciliations()
  console.log(`Found ${pending.length} pending reconciliation(s).`)

  if (pending.length === 0) {
    console.log('Nothing to reconcile.')
    return
  }

  const chain = await hiveChain()
  const results: ReconciliationResult[] = []

  for (const entry of pending) {
    const result = await reconcileEntry(entry, chain)
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
    abandoned: results.filter(r => r.action === 'abandoned').length,
    errors: results.filter(r => r.action === 'error').length,
  }

  console.log('\n--- Summary ---')
  console.log(`Total:              ${summary.total}`)
  console.log(`Completed DB:       ${summary.completedDb}`)
  console.log(`Rolled back:        ${summary.rolledBack}`)
  console.log(`Already consistent: ${summary.alreadyConsistent}`)
  console.log(`Abandoned:          ${summary.abandoned}`)
  console.log(`Errors:             ${summary.errors}`)

  if (summary.errors > 0 || summary.abandoned > 0) {
    console.error(
      '\nSome entries had errors or were abandoned. Review logs above.'
    )
    process.exit(1)
  }
}

main().catch(error => {
  console.error('Reconciliation failed:', error)
  process.exit(1)
})
