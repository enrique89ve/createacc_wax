import { logger } from '@/lib/logger'
import { BLOCKCHAIN_STATUS } from '@/consts/hive-execution'
import { db } from '@/lib/database'
import { getCreationAttempt } from '@/lib/creation-attempts'
import {
	fetchHiveAccountAuthorities,
	hiveAuthoritiesMatchExpected,
} from '@/lib/hive-account-authorities'
import { updateAccountBlockchainStatus } from '@/utils/db-ticket-validator'
import { claimAndQueueConfirmedRc } from '@/lib/create/queue-rc-delegation'

export interface BroadcastedAccountRow {
	readonly username: string
	readonly correlationId: string | null
}

export async function listBroadcastedAccounts(): Promise<BroadcastedAccountRow[]> {
	const result = await db.execute({
		sql: `SELECT username, correlation_id
			FROM Accounts
			WHERE blockchain_status = ?`,
		args: [BLOCKCHAIN_STATUS.BROADCASTED],
	})
	return result.rows.map((row) => ({
		username: String(row.username),
		correlationId: typeof row.correlation_id === 'string' ? row.correlation_id : null,
	}))
}

export async function confirmBroadcastedAccount(
	account: BroadcastedAccountRow
): Promise<boolean> {
	if (!account.correlationId) {
		logger.warn(
			`[confirm-broadcasted] ${account.username} has no correlation_id; leaving broadcasted`
		)
		return false
	}

	const attempt = await getCreationAttempt(account.correlationId)
	if (!attempt) {
		logger.warn(
			`[${account.correlationId}] No creation attempt for broadcasted ${account.username}`
		)
		return false
	}

	const lookup = await fetchHiveAccountAuthorities(account.username)
	if (lookup.status !== 'found') {
		logger.warn(
			`[${account.correlationId}] Hive lookup for broadcasted ${account.username} was ${lookup.status}`
		)
		return false
	}

	if (!hiveAuthoritiesMatchExpected(lookup.authorities, attempt.keys)) {
		logger.warn(
			`[${account.correlationId}] Broadcasted ${account.username} exists with different authorities`
		)
		return false
	}

	const updated = await updateAccountBlockchainStatus(
		account.username,
		BLOCKCHAIN_STATUS.CONFIRMED
	)
	if (!updated) return false

	await claimAndQueueConfirmedRc(account.username)
	return true
}

export async function confirmPendingBroadcastedAccounts(): Promise<number> {
	const pending = await listBroadcastedAccounts()
	let confirmed = 0
	for (const account of pending) {
		if (await confirmBroadcastedAccount(account)) confirmed += 1
	}
	return confirmed
}
