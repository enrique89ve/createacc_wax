import bcrypt from 'bcryptjs'
import { db } from '../src/lib/database'
import { initializeDatabase } from '../src/lib/database'

const SEED_DEFAULTS = {
	ADMIN_USERNAME: process.env.SEED_ADMIN_USERNAME || 'admin',
	ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || 'Admin123!',
	BUILDER_USERNAME: process.env.SEED_BUILDER_USERNAME || 'builder-demo',
	TICKET_CODE: process.env.SEED_TICKET_CODE || 'DEMO-TICKET',
	TICKET_CREDITS: 5,
} as const

async function rowExists(table: string, column: string, value: string): Promise<boolean> {
	const result = await db.execute({
		sql: `SELECT COUNT(*) as count FROM ${table} WHERE ${column} = ?`,
		args: [value],
	})
	return (result.rows[0]?.count as number) > 0
}

async function seedAdmin(): Promise<number | null> {
	if (await rowExists('Users', 'role', 'admin')) {
		console.log('  Admin already exists, skipping.')
		const result = await db.execute("SELECT id FROM Users WHERE role = 'admin'")
		return result.rows[0]?.id as number
	}

	const passwordHash = await bcrypt.hash(SEED_DEFAULTS.ADMIN_PASSWORD, 10)
	const result = await db.execute({
		sql: `INSERT INTO Users (username, password_hash, role, is_active)
			  VALUES (?, ?, 'admin', TRUE)`,
		args: [SEED_DEFAULTS.ADMIN_USERNAME, passwordHash],
	})
	console.log(`  Admin created: ${SEED_DEFAULTS.ADMIN_USERNAME}`)
	return Number(result.lastInsertRowid)
}

async function seedBuilder(adminId: number): Promise<number | null> {
	if (await rowExists('Users', 'username', SEED_DEFAULTS.BUILDER_USERNAME)) {
		console.log('  Builder already exists, skipping.')
		const result = await db.execute({
			sql: 'SELECT id FROM Users WHERE username = ?',
			args: [SEED_DEFAULTS.BUILDER_USERNAME],
		})
		return result.rows[0]?.id as number
	}

	const result = await db.execute({
		sql: `INSERT INTO Users (username, role, is_active)
			  VALUES (?, 'builder', TRUE)`,
		args: [SEED_DEFAULTS.BUILDER_USERNAME],
	})
	const builderId = Number(result.lastInsertRowid)

	// Create credits record for the builder
	await db.execute({
		sql: `INSERT INTO Credits (builder_id, available_amount, total_assigned)
			  VALUES (?, 10, 10)`,
		args: [builderId],
	})
	console.log(`  Builder created: ${SEED_DEFAULTS.BUILDER_USERNAME} (10 credits)`)
	return builderId
}

async function seedTicket(createdBy: number): Promise<void> {
	if (await rowExists('Tickets', 'code', SEED_DEFAULTS.TICKET_CODE)) {
		console.log('  Ticket already exists, skipping.')
		return
	}

	await db.execute({
		sql: `INSERT INTO Tickets (code, description, original_credits, credits, created_by)
			  VALUES (?, 'Demo ticket for development', ?, ?, ?)`,
		args: [
			SEED_DEFAULTS.TICKET_CODE,
			SEED_DEFAULTS.TICKET_CREDITS,
			SEED_DEFAULTS.TICKET_CREDITS,
			createdBy,
		],
	})
	console.log(`  Ticket created: ${SEED_DEFAULTS.TICKET_CODE} (${SEED_DEFAULTS.TICKET_CREDITS} credits)`)
}

async function main() {
	console.log('Seeding database...\n')

	try {
		// Ensure schema exists
		await initializeDatabase()

		// Seed data
		console.log('[1/3] Admin user:')
		const adminId = await seedAdmin()
		if (!adminId) {
			console.error('Failed to create or find admin.')
			process.exit(1)
		}

		console.log('[2/3] Builder user:')
		const builderId = await seedBuilder(adminId)

		console.log('[3/3] Demo ticket:')
		await seedTicket(builderId || adminId)

		console.log('\nSeed completed successfully!\n')
		console.log('Credentials:')
		console.log(`  Admin:   ${SEED_DEFAULTS.ADMIN_USERNAME} / ${SEED_DEFAULTS.ADMIN_PASSWORD}`)
		console.log(`  Builder: ${SEED_DEFAULTS.BUILDER_USERNAME} (keychain auth)`)
		console.log(`  Ticket:  ${SEED_DEFAULTS.TICKET_CODE}`)
		console.log(`\nLogin at /management/access`)
	} catch (error) {
		console.error('Seed failed:', error)
		process.exit(1)
	}
}

main()
