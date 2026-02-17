/**
 * Reconciliation consumer for ambiguous account creation operations.
 *
 * Reads pending entries from ReconciliationQueue, checks on-chain state,
 * and resolves each entry:
 *
 * - If account exists on-chain AND in DB → already reconciled, mark resolved.
 * - If account exists on-chain but NOT in DB → complete DB operations, mark resolved.
 * - If account does NOT exist on-chain → rollback the ticket credit, mark resolved.
 *
 * Usage:
 *   pnpm tsx scripts/reconcile-pending.ts
 *   pnpm tsx scripts/reconcile-pending.ts --dry-run
 */

import { initializeDatabase } from '@/lib/database'
import {
	getPendingReconciliations,
	resolveReconciliationEntry,
	completeAccountCreationInDB,
	rollbackTicketReservation,
	accountExistsInDB,
	obfuscateTicket,
} from '@/utils/db-ticket-validator'
import { hiveChain } from '@/lib/hiveservice'
import { validateHiveAccountExists } from '@/utils/validate-hiveuser'
import { RECONCILIATION_CONFIG } from '@/consts/constants'

const RESOLVER_ID = 'reconcile-script'
const isDryRun = process.argv.includes('--dry-run')

interface ReconciliationResult {
	readonly entryId: number
	readonly correlationId: string
	readonly username: string
	readonly action: 'completed_db' | 'rolled_back' | 'already_consistent' | 'error'
	readonly detail: string
}

async function reconcileEntry(
	entry: Awaited<ReturnType<typeof getPendingReconciliations>>[number],
	chain: Awaited<ReturnType<typeof hiveChain>>
): Promise<ReconciliationResult> {
	const { id, correlationId, username, ticketCode, reason } = entry
	const obfuscated = obfuscateTicket(ticketCode)

	try {
		// Step 1: Check if account exists on-chain
		const existsOnChain = await validateHiveAccountExists({
			chain,
			accountName: username,
		})

		// Step 2: Check if account exists in our DB
		const existsInDB = await accountExistsInDB(username)

		if (existsOnChain && existsInDB) {
			// Already consistent — nothing to do
			if (!isDryRun) {
				await resolveReconciliationEntry(id, RESOLVER_ID)
			}
			return {
				entryId: id,
				correlationId,
				username,
				action: 'already_consistent',
				detail: `Account exists on-chain and in DB. Resolved.`,
			}
		}

		if (existsOnChain && !existsInDB) {
			// Account was created on-chain but DB operations failed.
			// Complete the DB side (save account, mark credits consumed).
			if (!isDryRun) {
				const dbResult = await completeAccountCreationInDB(username, ticketCode, correlationId)
				if (!dbResult.success) {
					return {
						entryId: id,
						correlationId,
						username,
						action: 'error',
						detail: `DB completion failed: ${dbResult.error}. Ticket: ${obfuscated}`,
					}
				}
				await resolveReconciliationEntry(id, RESOLVER_ID)
			}
			return {
				entryId: id,
				correlationId,
				username,
				action: 'completed_db',
				detail: `Account on-chain but not in DB. ${isDryRun ? 'Would complete' : 'Completed'} DB operations. Ticket: ${obfuscated}`,
			}
		}

		// Account does NOT exist on-chain → the broadcast truly failed.
		// Rollback the ticket credit so it can be reused.
		if (!isDryRun) {
			const rollbackResult = await rollbackTicketReservation(ticketCode, correlationId)
			if (!rollbackResult.success) {
				// Rollback failed — do NOT mark as resolved so it can be retried
				return {
					entryId: id,
					correlationId,
					username,
					action: 'error',
					detail: `Rollback failed: ${rollbackResult.error}. Entry NOT resolved. Ticket: ${obfuscated}`,
				}
			}
			await resolveReconciliationEntry(id, RESOLVER_ID)
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
		return {
			entryId: id,
			correlationId,
			username,
			action: 'error',
			detail: `Error processing: ${errMsg}`,
		}
	}
}

async function main() {
	console.log(`--- Reconciliation Consumer ${isDryRun ? '(DRY RUN)' : ''} ---`)

	await initializeDatabase()

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
		await new Promise(r => setTimeout(r, RECONCILIATION_CONFIG.RATE_LIMIT_DELAY_MS))
	}

	// Summary
	const summary = {
		total: results.length,
		completedDb: results.filter(r => r.action === 'completed_db').length,
		rolledBack: results.filter(r => r.action === 'rolled_back').length,
		alreadyConsistent: results.filter(r => r.action === 'already_consistent').length,
		errors: results.filter(r => r.action === 'error').length,
	}

	console.log('\n--- Summary ---')
	console.log(`Total:              ${summary.total}`)
	console.log(`Completed DB:       ${summary.completedDb}`)
	console.log(`Rolled back:        ${summary.rolledBack}`)
	console.log(`Already consistent: ${summary.alreadyConsistent}`)
	console.log(`Errors:             ${summary.errors}`)

	if (summary.errors > 0) {
		console.error('\nSome entries had errors. Review logs above.')
		process.exit(1)
	}

	chain.delete()
}

main().catch(error => {
	console.error('Reconciliation failed:', error)
	process.exit(1)
})
