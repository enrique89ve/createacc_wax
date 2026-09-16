import './test-setup-env.ts'
import { initializeDatabase, db } from '@/lib/database'
import {
	completeAccountCreationInDB,
	getPendingReconciliations,
	reserveTicketCredit,
} from '@/utils/db-ticket-validator'
import { HiveKeys } from '@/lib/create/get-keys'
import { createAccount } from '@/lib/create/create-account'
import { noopHiveBroadcast } from '@/lib/hive-broadcaster'
import { isSimulationSuccess } from '@/types/hive-transaction'

const BUILDER_ID = '22222222-2222-4222-8222-222222222222'

function isolationIds(): { ticket: string; username: string } {
	const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
	return {
		ticket: `INTSIM${suffix.toUpperCase()}`,
		username: `hhint${suffix}`,
	}
}

async function cleanupOwnRecords(ticket: string, username: string): Promise<void> {
	await db.execute({ sql: `DELETE FROM Accounts WHERE username = ?`, args: [username] })
	await db.execute({ sql: `DELETE FROM Tickets WHERE code = ?`, args: [ticket] })
}

async function main(): Promise<void> {
	process.env.HIVE_TX_MODE = 'simulate'
	delete process.env.HIVE_BROADCAST_CONFIRM

	const { ticket, username } = isolationIds()
	const correlationId = `corr-${username}`

	const ok = await initializeDatabase()
	if (!ok) throw new Error('DB init failed')

	try {
		await db.execute({
			sql: `INSERT OR IGNORE INTO "user" (
				id, name, email, email_verified, username, role, auth_method, is_active
			) VALUES (?, ?, ?, 1, ?, 'builder', 'keychain', 1)`,
			args: [BUILDER_ID, 'int-builder', 'int-builder@hive.local', 'int-builder'],
		})
		await db.execute({
			sql: `INSERT OR IGNORE INTO Credits (builder_id, pending_amount, available_amount, total_assigned, total_consumed)
				VALUES (?, 0, 10, 10, 0)`,
			args: [BUILDER_ID],
		})
		await db.execute({
			sql: `INSERT INTO Tickets (code, description, original_credits, credits, created_by)
				VALUES (?, 'integration sim', 3, 3, ?)`,
			args: [ticket, BUILDER_ID],
		})

		const before = await db.execute({
			sql: `SELECT credits FROM Tickets WHERE code = ?`,
			args: [ticket],
		})
		const creditsBefore = Number(before.rows[0]?.credits)
		const keys = await HiveKeys.generate(username)
		const reserved = await reserveTicketCredit(ticket, correlationId)
		if (!reserved.success) throw new Error(reserved.error)

		const tx = await createAccount(keys.toCreateAccountParams(username), {
			broadcast: noopHiveBroadcast,
		})
		if (!isSimulationSuccess(tx)) {
			throw new Error('Simulation did not pass WAX checks')
		}
		if (tx.broadcasted) throw new Error('Broadcast occurred during simulation')
		if (!tx.wax.onChainVerified) throw new Error('on-chain verification did not pass')

		const dbResult = await completeAccountCreationInDB(username, ticket, correlationId, tx)
		if (!dbResult.success) throw new Error(dbResult.error)

		const after = await db.execute({
			sql: `SELECT credits FROM Tickets WHERE code = ?`,
			args: [ticket],
		})
		const creditsAfter = Number(after.rows[0]?.credits)
		const account = await db.execute({
			sql: `SELECT execution_mode, blockchain_status FROM Accounts WHERE username = ?`,
			args: [username],
		})
		const pending = await getPendingReconciliations()
		const ownPending = pending.filter(entry => entry.correlationId === correlationId)
		const mode = String(account.rows[0]?.execution_mode)
		const status = String(account.rows[0]?.blockchain_status)

		if (creditsBefore !== 3) throw new Error(`Expected ticket credits 3 before, got ${creditsBefore}`)
		if (creditsAfter !== 2) throw new Error(`Expected ticket credits 2 after, got ${creditsAfter}`)
		if (mode !== 'simulate') throw new Error(`Expected execution_mode=simulate, got ${mode}`)
		if (status !== 'simulated') throw new Error(`Expected blockchain_status=simulated, got ${status}`)
		if (ownPending.length !== 0) {
			throw new Error(`Expected 0 reconciliations for ${correlationId}, got ${ownPending.length}`)
		}

		console.log(`ticket=${ticket} username=${username}`)
		console.log(`ticket before=${creditsBefore} after=${creditsAfter}`)
		console.log(`account mode=${mode} status=${status}`)
		console.log(`reconciliation=${ownPending.length}`)
		console.log('INTEGRATION SIMULATION PASSED')
	} finally {
		await cleanupOwnRecords(ticket, username)
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : 'Unknown error'
	console.error(message)
	process.exit(1)
})
