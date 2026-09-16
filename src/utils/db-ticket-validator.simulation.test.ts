import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initializeDatabase, db } from '@/lib/database'
import { hiveAuthEmail } from '@/lib/auth-user'
import {
	blockchainStatusFromTransaction,
	completeAccountCreationInDB,
	enqueueReconciliation,
	getAccountCreationState,
	getPendingReconciliations,
	reserveTicketCredit,
	rollbackTicketReservation,
	updateAccountBlockchainStatus,
} from '@/utils/db-ticket-validator'
import {
	findOpenCreationAttempt,
	getCreationAttempt,
	markAttemptBroadcasting,
	persistAttemptPreparation,
} from '@/lib/creation-attempts'
import { claimAccountRcDelegation } from '@/lib/create/queue-rc-delegation'
import { creationFlagsFromPersistedAccount } from '@/lib/account-status'
import { BLOCKCHAIN_STATUS, HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'
import type { HiveTransactionResult } from '@/types/hive-transaction'
import type { CreationAttemptKeys } from '@/lib/creation-attempts'

const RUN = crypto.randomUUID().replace(/-/g, '')
const TICKET = `SIMT${RUN.slice(0, 12).toUpperCase()}`
const BUILDER_ID = crypto.randomUUID()
const BUILDER_USERNAME = `simb${RUN.slice(0, 10)}`
const BUILDER_EMAIL = hiveAuthEmail(BUILDER_USERNAME)

function keysFor(username: string): CreationAttemptKeys {
	return {
		ownerPublicKey: `STM7owner${username}`,
		activePublicKey: `STM7active${username}`,
		postingPublicKey: `STM7posting${username}`,
		memoPublicKey: `STM7memo${username}`,
	}
}

function simulatedTx(id: string): HiveTransactionResult {
	return {
		id,
		mode: HIVE_TX_MODE_VALUES.SIMULATE,
		broadcasted: false,
		wax: {
			validated: true,
			onChainVerified: true,
			signed: true,
			authorityVerified: true,
		},
		requiredAuthorities: {},
		signaturePublicKeys: ['STM7public'],
	}
}

function reserveInput(correlationId: string, username: string) {
	return {
		ticketCode: TICKET,
		correlationId,
		username,
		keys: keysFor(username),
	}
}

async function cleanupFixture(): Promise<void> {
	await db.execute({ sql: `DELETE FROM Notifications WHERE user_id = ?`, args: [BUILDER_ID] })
	await db.execute({ sql: `DELETE FROM CreditAudit WHERE builder_id = ?`, args: [BUILDER_ID] })
	await db.execute({ sql: `DELETE FROM CreationAttempts WHERE ticket = ?`, args: [TICKET] })
	await db.execute({ sql: `DELETE FROM Accounts WHERE ticket = ?`, args: [TICKET] })
	await db.execute({ sql: `DELETE FROM Tickets WHERE code = ?`, args: [TICKET] })
	await db.execute({ sql: `DELETE FROM Credits WHERE builder_id = ?`, args: [BUILDER_ID] })
	await db.execute({ sql: `DELETE FROM "user" WHERE id = ?`, args: [BUILDER_ID] })
}

beforeAll(async () => {
	const ok = await initializeDatabase()
	expect(ok).toBe(true)
	await cleanupFixture()
	await db.execute({
		sql: `INSERT INTO "user" (
			id, name, email, email_verified, username, role, auth_method, is_active
		) VALUES (?, ?, ?, 1, ?, 'builder', 'keychain', 1)`,
		args: [BUILDER_ID, BUILDER_USERNAME, BUILDER_EMAIL, BUILDER_USERNAME],
	})
	await db.execute({
		sql: `INSERT INTO Credits (builder_id, pending_amount, available_amount, total_assigned, total_consumed)
			VALUES (?, 0, 10, 10, 0)`,
		args: [BUILDER_ID],
	})
	await db.execute({
		sql: `INSERT INTO Tickets (code, description, original_credits, credits, created_by)
			VALUES (?, 'sim', 3, 3, ?)`,
		args: [TICKET, BUILDER_ID],
	})
})

afterAll(async () => {
	await cleanupFixture()
})

describe('simulation DB completion', () => {
	it('T01 consumes ticket and stores simulated account', async () => {
		const username = `simu${Date.now().toString(36)}`
		const reserved = await reserveTicketCredit(reserveInput('corr-1', username))
		expect(reserved.success).toBe(true)

		const completed = await completeAccountCreationInDB(
			username,
			TICKET,
			'corr-1',
			simulatedTx('tx-sim-1')
		)
		expect(completed.success).toBe(true)

		const account = await db.execute({
			sql: `SELECT execution_mode, blockchain_status, wax_status, transaction_id FROM Accounts WHERE username = ?`,
			args: [username],
		})
		expect(account.rows[0]?.execution_mode).toBe('simulate')
		expect(account.rows[0]?.blockchain_status).toBe('simulated')
		expect(account.rows[0]?.wax_status).toBe('passed')
		expect(account.rows[0]?.transaction_id).toBe('tx-sim-1')

		const ticket = await db.execute({
			sql: `SELECT credits FROM Tickets WHERE code = ?`,
			args: [TICKET],
		})
		expect(Number(ticket.rows[0]?.credits)).toBe(2)
	})

	it('broadcasted tx is stored as broadcasted, not confirmed', async () => {
		const liveTx: HiveTransactionResult = {
			...simulatedTx('tx-live-1'),
			mode: HIVE_TX_MODE_VALUES.BROADCAST,
			broadcasted: true,
		}
		expect(blockchainStatusFromTransaction(liveTx)).toBe(BLOCKCHAIN_STATUS.BROADCASTED)

		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const username = `liveu${Date.now().toString(36)}`
		const reserved = await reserveTicketCredit(reserveInput('corr-live', username))
		expect(reserved.success).toBe(true)
		const completed = await completeAccountCreationInDB(
			username,
			TICKET,
			'corr-live',
			liveTx
		)
		expect(completed.success).toBe(true)
		const persisted = await getAccountCreationState(username)
		expect(persisted?.executionMode).toBe(HIVE_TX_MODE_VALUES.BROADCAST)
		expect(persisted?.blockchainStatus).toBe(BLOCKCHAIN_STATUS.BROADCASTED)
		expect(persisted?.transactionId).toBe('tx-live-1')
	})

	it('T07 concurrent reservation consumes one credit', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 1 WHERE code = ?`,
			args: [TICKET],
		})
		const [first, second] = await Promise.all([
			reserveTicketCredit(reserveInput('corr-a', `cona${Date.now().toString(36)}`)),
			reserveTicketCredit(reserveInput('corr-b', `conb${Date.now().toString(36)}`)),
		])
		const successes = [first, second].filter(result => result.success)
		expect(successes).toHaveLength(1)
		const failed = [first, second].find(result => !result.success)
		if (failed?.correlationId) {
			await rollbackTicketReservation(TICKET, failed.correlationId)
		}
		const winner = successes[0]
		if (winner?.correlationId) {
			await rollbackTicketReservation(TICKET, winner.correlationId)
		}
	})

	it('T06 simulation DB failure rolls back ticket and skips reconciliation', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const username = `failu${Date.now().toString(36)}`
		await reserveTicketCredit(reserveInput('corr-fail', username))
		const completed = await completeAccountCreationInDB(
			'',
			TICKET,
			'corr-fail',
			simulatedTx('tx-fail')
		)
		expect(completed.success).toBe(false)
		await rollbackTicketReservation(TICKET, 'corr-fail')
		await enqueueReconciliation({
			correlationId: 'corr-fail',
			username: 'nobody',
			ticketCode: TICKET,
			reason: 'db_completion_failed',
		})
		const pending = await getPendingReconciliations()
		expect(pending.filter(entry => entry.correlationId === 'corr-fail')).toHaveLength(0)
	})

	it('pipeline failure rolls the reserved ticket credit back', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const username = `waxu${Date.now().toString(36)}`
		const reserved = await reserveTicketCredit(reserveInput('corr-wax', username))
		expect(reserved.success).toBe(true)
		const mid = await db.execute({
			sql: `SELECT credits FROM Tickets WHERE code = ?`,
			args: [TICKET],
		})
		expect(Number(mid.rows[0]?.credits)).toBe(2)
		const rolled = await rollbackTicketReservation(TICKET, 'corr-wax')
		expect(rolled.success).toBe(true)
		const after = await db.execute({
			sql: `SELECT credits FROM Tickets WHERE code = ?`,
			args: [TICKET],
		})
		expect(Number(after.rows[0]?.credits)).toBe(3)
		expect(await getCreationAttempt('corr-wax')).toMatchObject({ status: 'rolled_back' })
	})

	it('duplicate username does not consume a second credit', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const username = `dupu${Date.now().toString(36)}`
		expect((await reserveTicketCredit(reserveInput('corr-dup-1', username))).success).toBe(true)
		expect(
			(await completeAccountCreationInDB(username, TICKET, 'corr-dup-1', simulatedTx('tx-dup-1'))).success
		).toBe(true)

		const other = `dupo${Date.now().toString(36)}`
		expect((await reserveTicketCredit(reserveInput('corr-dup-2', other))).success).toBe(true)
		const second = await completeAccountCreationInDB(
			username,
			TICKET,
			'corr-dup-2',
			simulatedTx('tx-dup-2')
		)
		expect(second.success).toBe(false)
		await rollbackTicketReservation(TICKET, 'corr-dup-2')

		const ticket = await db.execute({
			sql: `SELECT credits FROM Tickets WHERE code = ?`,
			args: [TICKET],
		})
		expect(Number(ticket.rows[0]?.credits)).toBe(2)
	})

	it('Hive confirmation upgrades broadcasted to confirmed from persisted state', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const username = `confu${Date.now().toString(36)}`
		expect((await reserveTicketCredit(reserveInput('corr-conf', username))).success).toBe(true)
		const liveTx: HiveTransactionResult = {
			...simulatedTx('tx-conf-1'),
			mode: HIVE_TX_MODE_VALUES.BROADCAST,
			broadcasted: true,
		}
		expect(
			(await completeAccountCreationInDB(username, TICKET, 'corr-conf', liveTx)).success
		).toBe(true)
		expect((await getAccountCreationState(username))?.blockchainStatus).toBe(
			BLOCKCHAIN_STATUS.BROADCASTED
		)

		expect(await updateAccountBlockchainStatus(username, BLOCKCHAIN_STATUS.CONFIRMED)).toBe(true)
		const persisted = await getAccountCreationState(username)
		expect(persisted?.blockchainStatus).toBe(BLOCKCHAIN_STATUS.CONFIRMED)
		const flags = creationFlagsFromPersistedAccount(persisted!)
		expect(flags.broadcasted).toBe(true)
		expect(flags.chainConfirmed).toBe(true)
		expect(flags.executionMode).toBe(HIVE_TX_MODE_VALUES.BROADCAST)
		expect(await claimAccountRcDelegation(username)).toBe(true)
		expect(await claimAccountRcDelegation(username)).toBe(false)
	})

	it('Hive-matched recovery persists confirmed even if broadcasted was never saved', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const username = `hivm${Date.now().toString(36)}`
		expect((await reserveTicketCredit(reserveInput('corr-hive-match', username))).success).toBe(true)
		await persistAttemptPreparation('corr-hive-match', {
			id: 'tx-timeout-1',
			wax: {
				validated: true,
				onChainVerified: true,
				signed: true,
				authorityVerified: true,
			},
		})
		const completed = await completeAccountCreationInDB(
			username,
			TICKET,
			'corr-hive-match',
			{
				...simulatedTx('tx-timeout-1'),
				mode: HIVE_TX_MODE_VALUES.BROADCAST,
				broadcasted: false,
			},
			{ hiveMatched: true }
		)
		expect(completed.success).toBe(true)
		const persisted = await getAccountCreationState(username)
		expect(persisted?.blockchainStatus).toBe(BLOCKCHAIN_STATUS.CONFIRMED)
		expect(persisted?.transactionId).toBe('tx-timeout-1')
	})

	it('rolls back a stale reserved attempt so a later reserve can proceed', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const username = `stal${Date.now().toString(36)}`
		expect((await reserveTicketCredit(reserveInput('corr-stale', username))).success).toBe(true)
		await db.execute({
			sql: `UPDATE CreationAttempts SET updated_at = datetime('now', '-10 minutes') WHERE correlation_id = ?`,
			args: ['corr-stale'],
		})
		const { recoverStaleCreationAttempts } = await import('@/lib/confirm-broadcasted')
		expect(await recoverStaleCreationAttempts()).toBeGreaterThan(0)
		expect(await getCreationAttempt('corr-stale')).toMatchObject({ status: 'rolled_back' })
		expect((await reserveTicketCredit(reserveInput('corr-stale-2', username))).success).toBe(true)
		await rollbackTicketReservation(TICKET, 'corr-stale-2')
	})

	it('ties a reserved credit to this username and keys, not the ticket counter', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3, original_credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const firstUser = `resu${Date.now().toString(36)}`
		const laterUser = `resl${Date.now().toString(36)}`
		expect(await findOpenCreationAttempt({
			username: laterUser,
			ticket: TICKET,
			keys: keysFor(laterUser),
		})).toBeNull()

		expect((await reserveTicketCredit(reserveInput('corr-reserved', firstUser))).success).toBe(true)
		expect(await findOpenCreationAttempt({
			username: firstUser,
			ticket: TICKET,
			keys: keysFor(firstUser),
		})).not.toBeNull()
		expect(await findOpenCreationAttempt({
			username: laterUser,
			ticket: TICKET,
			keys: keysFor(laterUser),
		})).toBeNull()

		await persistAttemptPreparation('corr-reserved', {
			id: 'prepared-tx-1',
			wax: {
				validated: true,
				onChainVerified: true,
				signed: true,
				authorityVerified: true,
			},
		})
		const attempt = await getCreationAttempt('corr-reserved')
		expect(attempt?.transactionId).toBe('prepared-tx-1')
		await rollbackTicketReservation(TICKET, 'corr-reserved')
	})

	it('refuses to mark broadcasting after the attempt lost ownership', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const username = `casu${Date.now().toString(36)}`
		expect((await reserveTicketCredit(reserveInput('corr-cas', username))).success).toBe(true)
		await persistAttemptPreparation('corr-cas', {
			id: 'tx-cas-1',
			wax: {
				validated: true,
				onChainVerified: true,
				signed: true,
				authorityVerified: true,
			},
		})
		expect((await rollbackTicketReservation(TICKET, 'corr-cas')).success).toBe(true)
		expect(await markAttemptBroadcasting('corr-cas')).toBe(false)
		expect(await getCreationAttempt('corr-cas')).toMatchObject({ status: 'rolled_back' })
	})

	it('keeps the attempt open if Hive-matched DB complete fails', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const username = `open${Date.now().toString(36)}`
		expect((await reserveTicketCredit(reserveInput('corr-open', username))).success).toBe(true)
		const { persistHiveMatchedAccount } = await import('@/lib/confirm-broadcasted')
		const attempt = await getCreationAttempt('corr-open')
		expect(attempt).not.toBeNull()
		expect(
			await persistHiveMatchedAccount({
				username: '',
				ticket: TICKET,
				correlationId: 'corr-open',
				attempt: attempt!,
			})
		).toBe(false)
		expect(await getCreationAttempt('corr-open')).toMatchObject({ status: 'reserved' })
		await rollbackTicketReservation(TICKET, 'corr-open')
	})
})
