import './test-setup-env.ts'
import { initializeDatabase, db } from '@/lib/database'
import {
	completeAccountCreationInDB,
	getPendingReconciliations,
	reserveTicketCredit,
} from '@/utils/db-ticket-validator'
import { HiveKeys } from '@/lib/create/get-keys'
import { createAccount } from '@/lib/create/create-account'
import { isSimulationSuccess } from '@/types/hive-transaction'

const TICKET = 'INTSIMTICKET01'
const BUILDER_ID = '22222222-2222-4222-8222-222222222222'

async function main(): Promise<void> {
	process.env.HIVE_TX_MODE = 'simulate'
	delete process.env.HIVE_BROADCAST_CONFIRM

	const ok = await initializeDatabase()
	if (!ok) throw new Error('DB init failed')

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
	await db.execute({ sql: `DELETE FROM Tickets WHERE code = ?`, args: [TICKET] })
	await db.execute({
		sql: `INSERT INTO Tickets (code, description, original_credits, credits, created_by)
			VALUES (?, 'integration sim', 3, 3, ?)`,
		args: [TICKET, BUILDER_ID],
	})

	const before = await db.execute({ sql: `SELECT credits FROM Tickets WHERE code = ?`, args: [TICKET] })
	const creditsBefore = Number(before.rows[0]?.credits)
	const username = `hhint${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
	const keys = await HiveKeys.generate(username)
	const reserved = await reserveTicketCredit(TICKET, `corr-${username}`)
	if (!reserved.success) throw new Error(reserved.error)

	const tx = await createAccount(keys.toCreateAccountParams(username))
	if (!isSimulationSuccess(tx)) {
		throw new Error('Simulation did not pass')
	}
	if (tx.broadcasted) throw new Error('Broadcast occurred during simulation')

	const dbResult = await completeAccountCreationInDB(username, TICKET, `corr-${username}`, tx)
	if (!dbResult.success) throw new Error(dbResult.error)

	const after = await db.execute({ sql: `SELECT credits FROM Tickets WHERE code = ?`, args: [TICKET] })
	const account = await db.execute({
		sql: `SELECT execution_mode, blockchain_status FROM Accounts WHERE username = ?`,
		args: [username],
	})
	const pending = await getPendingReconciliations()

	console.log(`ticket before=${creditsBefore} after=${after.rows[0]?.credits}`)
	console.log(`account mode=${account.rows[0]?.execution_mode} status=${account.rows[0]?.blockchain_status}`)
	console.log(`reconciliation=${pending.length}`)
	console.log('INTEGRATION SIMULATION PASSED')
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : 'Unknown error'
	console.error(message)
	process.exit(1)
})
