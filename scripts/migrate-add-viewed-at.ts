/**
 * Migration Script: Add viewed_at column to Notifications table
 *
 * This script adds the `viewed_at` column to track when a user opens the notification modal
 * (distinct from `read_at` which tracks when they explicitly mark as read).
 *
 * Usage: pnpm tsx scripts/migrate-add-viewed-at.ts
 */

import { db } from '../src/lib/database'

async function migrate() {
	console.log('Starting migration: Add viewed_at column to Notifications...')

	try {
		// Check if column already exists
		const tableInfo = await db.execute({
			sql: 'PRAGMA table_info(Notifications)',
			args: [],
		})

		const columns = tableInfo.rows.map((row: any) => row.name)
		const hasViewedAt = columns.includes('viewed_at')

		if (hasViewedAt) {
			console.log('✓ Column viewed_at already exists, skipping migration')
			return
		}

		// Add viewed_at column
		console.log('Adding viewed_at column...')
		await db.execute({
			sql: 'ALTER TABLE Notifications ADD COLUMN viewed_at DATETIME',
			args: [],
		})

		console.log('✓ Column viewed_at added successfully')

		// Create optimized index for cleanup queries
		console.log('Creating cleanup index...')
		await db.execute({
			sql: `
				CREATE INDEX IF NOT EXISTS idx_notifications_cleanup
				ON Notifications(user_id, is_read, viewed_at)
				WHERE viewed_at IS NOT NULL AND is_read = TRUE
			`,
			args: [],
		})

		console.log('✓ Index idx_notifications_cleanup created successfully')

		// Verify migration
		const verifyInfo = await db.execute({
			sql: 'PRAGMA table_info(Notifications)',
			args: [],
		})

		const newColumns = verifyInfo.rows.map((row: any) => row.name)
		if (newColumns.includes('viewed_at')) {
			console.log('✓ Migration completed successfully!')
			console.log(
				'\nNext steps:'
			)
			console.log('1. Run: pnpm db:reset (to apply triggers)')
			console.log('2. Run: pnpm dev')
		} else {
			console.error('✗ Migration verification failed')
			process.exit(1)
		}
	} catch (error) {
		console.error('✗ Migration failed:', error)
		process.exit(1)
	}
}

// Run migration
migrate().catch((error) => {
	console.error('Fatal error:', error)
	process.exit(1)
})
