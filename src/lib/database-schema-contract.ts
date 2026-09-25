export const DATABASE_SCHEMA_VERSION = 2

export const REQUIRED_DATABASE_COLUMNS = {
  DatabaseSchemaMetadata: ['singleton', 'schema_version', 'applied_at'],
  Tickets: [
    'id',
    'code',
    'total_uses',
    'remaining_uses',
    'funding_source',
    'owner_builder_username',
    'issuer_admin_id',
    'archived_at',
    'retired_uses',
  ],
  Accounts: [
    'username',
    'ticket_id',
    'builder_username',
    'correlation_id',
    'rc_lease_token',
    'rc_lease_generation',
  ],
  Credits: [
    'hive_username',
    'pending_amount',
    'available_amount',
    'total_issued',
    'total_consumed',
    'revision',
  ],
  AdminActionLog: [
    'id',
    'actor_user_id',
    'actor_username',
    'request_id',
    'action',
    'target_type',
    'target_id',
    'request_hash',
    'policy_version',
    'reason',
    'outcome',
    'before_state',
    'after_state',
    'receipt',
    'created_at',
  ],
  CreditAudit: ['hive_username', 'operation', 'amount', 'external_reference'],
  TicketAudit: ['ticket_id', 'actor_type', 'actor_id', 'operation_reference'],
  CreationAttempts: [
    'correlation_id',
    'ticket_id',
    'funding_source',
    'owner_builder_username',
    'version',
    'lease_token',
    'lease_expires_at',
    'lease_generation',
    'transaction_expires_at',
  ],
  CreationAttemptEvents: [
    'correlation_id',
    'event_type',
    'to_status',
    'operation_reference',
  ],
  ReconciliationQueue: [
    'correlation_id',
    'next_attempt_at',
    'lease_token',
    'lease_expires_at',
    'lease_generation',
  ],
} as const

export interface ExistingDatabaseSchema {
  readonly tables: ReadonlySet<string>
  readonly columnsByTable: ReadonlyMap<string, ReadonlySet<string>>
}

export interface DatabaseSchemaGaps {
  readonly missingTables: readonly string[]
  readonly missingColumns: readonly string[]
}

export function findDatabaseSchemaGaps(
  existing: ExistingDatabaseSchema
): DatabaseSchemaGaps {
  const missingTables: string[] = []
  const missingColumns: string[] = []
  for (const [table, requiredColumns] of Object.entries(
    REQUIRED_DATABASE_COLUMNS
  )) {
    if (!existing.tables.has(table)) {
      missingTables.push(table)
      continue
    }
    const availableColumns = existing.columnsByTable.get(table) ?? new Set()
    for (const column of requiredColumns) {
      if (!availableColumns.has(column)) {
        missingColumns.push(`${table}.${column}`)
      }
    }
  }
  return { missingTables, missingColumns }
}

export function hasUserTables(existingTables: ReadonlySet<string>): boolean {
  return [...existingTables].some(table => !table.startsWith('sqlite_'))
}
