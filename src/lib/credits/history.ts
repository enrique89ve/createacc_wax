/**
 * Credit history and audit queries.
 * Read-only operations for viewing credit operation history.
 */

import { db } from '../database'

/**
 * Get raw credit audit rows for a builder.
 */
export async function getCreditAuditHistory(builderId: number) {
	const result = await db.execute({
		sql: `
			SELECT id, builder_id, operation, amount, reason, performed_by, timestamp FROM CreditAudit
			WHERE builder_id = ?
			ORDER BY timestamp DESC
		`,
		args: [builderId],
	})

	return result.rows
}

/**
 * Get typed credit history for a builder.
 */
export async function getCreditHistory(builderId: number): Promise<
	Array<{
		readonly id: number
		readonly operation: string
		readonly amount: number
		readonly reason: string | null
		readonly timestamp: string
		readonly performed_by: number | null
	}>
> {
	try {
		const result = await db.execute({
			sql: `
				SELECT
					id, operation, amount, reason, timestamp, performed_by
				FROM CreditAudit
				WHERE builder_id = ?
				ORDER BY timestamp DESC
			`,
			args: [builderId],
		})

		return result.rows.map((row: Record<string, unknown>) => ({
			id: Number(row.id),
			operation: String(row.operation),
			amount: Number(row.amount),
			reason: row.reason as string | null,
			timestamp: String(row.timestamp),
			performed_by: row.performed_by as number | null,
		}))
	} catch (_error) {
		return []
	}
}
