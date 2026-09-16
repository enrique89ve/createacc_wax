import { logger } from '@/lib/logger'
import { BLOCKCHAIN_STATUS, CREATION_ATTEMPT_STATUS } from '@/consts/hive-execution'
import { RECONCILIATION_CONFIG } from '@/consts/constants'
import { db } from '@/lib/database'
import {
	getCreationAttempt,
	hiveTransactionFromRecoveredAttempt,
	isAttemptStale,
	listOpenCreationAttempts,
	markAttemptRecoveredOnChain,
	normalizeAttemptTicket,
	type CreationAttempt,
} from '@/lib/creation-attempts'
import {
	fetchHiveAccountAuthorities,
	hiveAuthoritiesMatchExpected,
} from '@/lib/hive-account-authorities'
import { recoverOwnedAccount } from '@/lib/recover-owned-account'
import {
	accountExistsInDB,
	completeAccountCreationInDB,
	rollbackTicketReservation,
	updateAccountBlockchainStatus,
} from '@/utils/db-ticket-validator'
import { claimAndQueueConfirmedRc } from '@/lib/create/queue-rc-delegation'

export interface BroadcastedAccountRow {
	readonly username: string
	readonly correlationId: string | null
	readonly ticket: string
}

export async function persistHiveMatchedAccount(params: {
	readonly username: string
	readonly ticket: string
	readonly correlationId: string
	readonly attempt: CreationAttempt
}): Promise<boolean> {
	const exists = await accountExistsInDB(params.username)
	if (!exists) {
		const dbResult = await completeAccountCreationInDB(
			params.username,
			params.ticket,
			params.correlationId,
			hiveTransactionFromRecoveredAttempt(params.attempt) ?? undefined,
			{ hiveMatched: true }
		)
		if (!dbResult.success) {
			logger.error(
				`[${params.correlationId}] Hive-matched complete failed for ${params.username}: ${dbResult.error}`
			)
			return false
		}
	}

	const confirmed = await updateAccountBlockchainStatus(
		params.username,
		BLOCKCHAIN_STATUS.CONFIRMED
	)
	if (!confirmed) return false
	await markAttemptRecoveredOnChain(params.correlationId)
	await claimAndQueueConfirmedRc(params.username)
	return true
}

export async function listBroadcastedAccounts(): Promise<BroadcastedAccountRow[]> {
	const result = await db.execute({
		sql: `SELECT username, correlation_id, ticket
			FROM Accounts
			WHERE blockchain_status IN (?, ?)`,
		args: [BLOCKCHAIN_STATUS.BROADCASTED, BLOCKCHAIN_STATUS.FAILED],
	})
	return result.rows.map((row) => ({
		username: String(row.username),
		correlationId: typeof row.correlation_id === 'string' ? row.correlation_id : null,
		ticket: String(row.ticket),
	}))
}

export async function confirmBroadcastedAccount(
	account: BroadcastedAccountRow
): Promise<boolean> {
	if (!account.correlationId) {
		logger.warn(
			`[confirm-broadcasted] ${account.username} has no correlation_id; leaving ${account.username}`
		)
		return false
	}

	const attempt = await getCreationAttempt(account.correlationId)
	if (!attempt) {
		logger.warn(
			`[${account.correlationId}] No creation attempt for ${account.username}`
		)
		return false
	}

	const lookup = await fetchHiveAccountAuthorities(account.username)
	if (lookup.status !== 'found') {
		logger.warn(
			`[${account.correlationId}] Hive lookup for ${account.username} was ${lookup.status}`
		)
		return false
	}

	if (!hiveAuthoritiesMatchExpected(lookup.authorities, attempt.keys)) {
		logger.warn(
			`[${account.correlationId}] ${account.username} exists with different authorities`
		)
		return false
	}

	return persistHiveMatchedAccount({
		username: account.username,
		ticket: account.ticket,
		correlationId: account.correlationId,
		attempt,
	})
}

export async function confirmPendingBroadcastedAccounts(): Promise<number> {
	const pending = await listBroadcastedAccounts()
	let confirmed = 0
	for (const account of pending) {
		if (await confirmBroadcastedAccount(account)) confirmed += 1
	}
	return confirmed
}

async function recoverStaleAttempt(attempt: CreationAttempt): Promise<void> {
	if (
		attempt.status === CREATION_ATTEMPT_STATUS.RESERVED ||
		attempt.status === CREATION_ATTEMPT_STATUS.PREPARED
	) {
		await rollbackTicketReservation(attempt.ticket, attempt.correlationId)
		logger.info(
			`[${attempt.correlationId}] Rolled back stale ${attempt.status} attempt for ${attempt.username}`
		)
		return
	}

	const recovered = await recoverOwnedAccount({
		username: attempt.username,
		ticket: attempt.ticket,
		keys: attempt.keys,
		correlationId: attempt.correlationId,
	})

	if (recovered.kind === 'recovered') {
		await persistHiveMatchedAccount({
			username: attempt.username,
			ticket: attempt.ticket,
			correlationId: attempt.correlationId,
			attempt,
		})
		return
	}

	if (
		recovered.kind === 'not_found' ||
		recovered.kind === 'foreign_account' ||
		recovered.kind === 'ambiguous'
	) {
		await rollbackTicketReservation(attempt.ticket, attempt.correlationId)
		logger.info(
			`[${attempt.correlationId}] Rolled back stale broadcasting attempt (${recovered.kind}) for ${attempt.username}`
		)
	}
}

export async function recoverStaleCreationAttempts(): Promise<number> {
	const open = await listOpenCreationAttempts()
	let recovered = 0
	for (const attempt of open) {
		if (!isAttemptStale(attempt.updatedAt, RECONCILIATION_CONFIG.ATTEMPT_STALE_MS)) {
			continue
		}
		await recoverStaleAttempt(attempt)
		recovered += 1
	}
	return recovered
}

export function sameAttemptIdentity(
	attempt: CreationAttempt,
	ticket: string,
	keys: CreationAttempt['keys']
): boolean {
	return (
		attempt.ticket === normalizeAttemptTicket(ticket) &&
		attempt.keys.ownerPublicKey === keys.ownerPublicKey &&
		attempt.keys.activePublicKey === keys.activePublicKey &&
		attempt.keys.postingPublicKey === keys.postingPublicKey &&
		attempt.keys.memoPublicKey === keys.memoPublicKey
	)
}
