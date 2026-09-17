import { execute } from '../database'

export async function getCreditAuditHistory(hiveUsername: string) {
  const result = await execute({
    sql: `
			SELECT id, hive_username, operation, amount, reason, performed_by,
				external_reference, timestamp
			FROM CreditAudit
			WHERE hive_username = ?
			ORDER BY timestamp DESC
		`,
    args: [hiveUsername],
  })

  return result.rows
}

export async function getCreditHistory(hiveUsername: string): Promise<
  Array<{
    readonly id: number
    readonly operation: string
    readonly amount: number
    readonly reason: string | null
    readonly timestamp: string
    readonly performed_by: string | null
    readonly external_reference: string | null
  }>
> {
  try {
    const result = await execute({
      sql: `
				SELECT id, operation, amount, reason, timestamp, performed_by,
					external_reference
				FROM CreditAudit
				WHERE hive_username = ?
				ORDER BY timestamp DESC
			`,
      args: [hiveUsername],
    })

    return result.rows.map((row: Record<string, unknown>) => ({
      id: Number(row.id),
      operation: String(row.operation),
      amount: Number(row.amount),
      reason: row.reason as string | null,
      timestamp: String(row.timestamp),
      performed_by:
        typeof row.performed_by === 'string' ? row.performed_by : null,
      external_reference:
        typeof row.external_reference === 'string'
          ? row.external_reference
          : null,
    }))
  } catch {
    return []
  }
}
