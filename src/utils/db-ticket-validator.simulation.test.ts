import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initializeDatabase, db } from '@/lib/database'
import {
	blockchainStatusFromTransaction,
	completeAccountCreationInDB,
	enqueueReconciliation,
	getAccountCreationState,
	getPendingReconciliations,
	reserveTicketCredit,
	rollbackTicketReservation,
	updateAccountBlockchainStatus,
	ticketCreditAlreadyReserved,
} from '@/utils/db-ticket-validator'
import { creationFlagsFromPersistedAccount } from '@/lib/account-status'
import { BLOCKCHAIN_STATUS, HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'
import type { HiveTransactionResult } from '@/types/hive-transaction'

const TICKET = 'SIMTESTTICKET01'
const BUILDER_ID = '11111111-1111-4111-8111-111111111111'

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

beforeAll(async () => {
	const ok = await initializeDatabase()
	expect(ok).toBe(true)
	await db.execute({
		sql: `INSERT OR IGNORE INTO "user" (
			id, name, email, email_verified, username, role, auth_method, is_active
		) VALUES (?, ?, ?, 1, ?, 'builder', 'keychain', 1)`,
		args: [BUILDER_ID, 'sim-builder', 'sim-builder@hive.local', 'sim-builder'],
	})
	await db.execute({
		sql: `INSERT OR IGNORE INTO Credits (builder_id, pending_amount, available_amount, total_assigned, total_consumed)
			VALUES (?, 0, 10, 10, 0)`,
		args: [BUILDER_ID],
	})
	await db.execute({
		sql: `DELETE FROM Tickets WHERE code = ?`,
		args: [TICKET],
	})
	await db.execute({
		sql: `INSERT INTO Tickets (code, description, original_credits, credits, created_by)
			VALUES (?, 'sim', 3, 3, ?)`,
		args: [TICKET, BUILDER_ID],
	})
})

afterAll(async () => {
	await db.execute({ sql: `DELETE FROM Accounts WHERE ticket = ?`, args: [TICKET] })
	await db.execute({ sql: `DELETE FROM Tickets WHERE code = ?`, args: [TICKET] })
})

describe('simulation DB completion', () => {
	it('T01 consumes ticket and stores simulated account', async () => {
		const reserved = await reserveTicketCredit(TICKET, 'corr-1')
		expect(reserved.success).toBe(true)

		const username = `simuser${Date.now().toString(36)}`
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
		const reserved = await reserveTicketCredit(TICKET, 'corr-live')
		expect(reserved.success).toBe(true)
		const username = `liveuser${Date.now().toString(36)}`
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
			reserveTicketCredit(TICKET, 'corr-a'),
			reserveTicketCredit(TICKET, 'corr-b'),
		])
		const successes = [first, second].filter(result => result.success)
		expect(successes).toHaveLength(1)
	})

	it('T06 simulation DB failure rolls back ticket and skips reconciliation', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		await reserveTicketCredit(TICKET, 'corr-fail')
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
		const reserved = await reserveTicketCredit(TICKET, 'corr-wax')
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
	})

	it('duplicate username does not consume a second credit', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		const username = `dupuser${Date.now().toString(36)}`
		expect((await reserveTicketCredit(TICKET, 'corr-dup-1')).success).toBe(true)
		expect(
			(await completeAccountCreationInDB(username, TICKET, 'corr-dup-1', simulatedTx('tx-dup-1'))).success
		).toBe(true)

		expect((await reserveTicketCredit(TICKET, 'corr-dup-2')).success).toBe(true)
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
		const username = `confuser${Date.now().toString(36)}`
		expect((await reserveTicketCredit(TICKET, 'corr-conf')).success).toBe(true)
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
	})

	it('detects a reserved ticket credit for HTTP retry recovery', async () => {
		await db.execute({
			sql: `UPDATE Tickets SET credits = 3, original_credits = 3 WHERE code = ?`,
			args: [TICKET],
		})
		expect(await ticketCreditAlreadyReserved(TICKET)).toBe(false)
		expect((await reserveTicketCredit(TICKET, 'corr-reserved')).success).toBe(true)
		expect(await ticketCreditAlreadyReserved(TICKET)).toBe(true)
	})
})
