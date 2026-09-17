import { execute } from '../database'

export async function insertCreditAudit(params: {
  readonly hiveUsername: string
  readonly operation: string
  readonly amount: number
  readonly reason: string
  readonly performedBy?: string
  readonly externalReference?: string
}): Promise<void> {
  await execute({
    sql: `
			INSERT INTO CreditAudit (
				hive_username, operation, amount, reason, performed_by,
				external_reference, timestamp
			) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		`,
    args: [
      params.hiveUsername,
      params.operation,
      params.amount,
      params.reason,
      params.performedBy ?? null,
      params.externalReference ?? null,
    ],
  })
}

export async function selectCreditRow(hiveUsername: string): Promise<{
  pending_amount: number
  available_amount: number
  total_assigned: number
  total_consumed: number
} | null> {
  const result = await execute({
    sql: `
			SELECT pending_amount, available_amount, total_assigned, total_consumed
			FROM Credits
			WHERE hive_username = ?
		`,
    args: [hiveUsername],
  })

  if (result.rows.length === 0) return null

  const row = result.rows[0] as Record<string, unknown>
  return {
    pending_amount: Number(row.pending_amount || 0),
    available_amount: Number(row.available_amount || 0),
    total_assigned: Number(row.total_assigned || 0),
    total_consumed: Number(row.total_consumed || 0),
  }
}
