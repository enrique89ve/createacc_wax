/**
 * Shared helpers for the credits system.
 * Internal module — not intended for direct import by consumers.
 */

import { db } from '../database'

/**
 * Ensure a credits row exists for a builder.
 * Creates one with zeroed values if missing.
 */
export async function getOrCreateCreditRow(builderId: number): Promise<void> {
	const existing = await db.execute({
		sql: 'SELECT id FROM Credits WHERE builder_id = ?',
		args: [builderId],
	})

	if (existing.rows.length === 0) {
		await db.execute({
			sql: `
				INSERT INTO Credits (builder_id, pending_amount, available_amount, total_assigned, total_consumed)
				VALUES (?, 0, 0, 0, 0)
			`,
			args: [builderId],
		})
	}
}

/**
 * Insert an entry into the CreditAudit table.
 */
export async function insertCreditAudit(params: {
	readonly builderId: number
	readonly operation: string
	readonly amount: number
	readonly reason: string
	readonly performedBy?: number
}): Promise<void> {
	await db.execute({
		sql: `
			INSERT INTO CreditAudit (
				builder_id, operation, amount, reason, performed_by, timestamp
			) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		`,
		args: [
			params.builderId,
			params.operation,
			params.amount,
			params.reason,
			params.performedBy ?? null,
		],
	})
}
