import { AsyncLocalStorage } from 'node:async_hooks'
import {
  createClient,
  type Transaction,
  type InStatement,
  type ResultSet,
} from '@libsql/client'
import { UserRole } from '@/lib/roles'
import { logger } from '@/lib/logger'
import { hiveAuthEmail } from '@/lib/auth-user'
import { resolveDatabaseConfiguration } from '@/lib/database-config'
import {
  findDatabaseSchemaGaps,
  hasUserTables,
  DATABASE_SCHEMA_VERSION,
  REQUIRED_DATABASE_COLUMNS,
} from '@/lib/database-schema-contract'
import {
  ADMIN_ACTION_LOG_INDEX_STATEMENTS,
  ADMIN_ACTION_LOG_TABLE_SQL,
} from '@/lib/database-migrations'
import {
  BLOCKCHAIN_STATUS,
  HIVE_TX_MODE_VALUES,
  RC_STATUS,
} from '@/consts/hive-execution'
import { CREATION_ATTEMPT_EVENT_TYPES } from '@/consts/creation-attempt-events'

export const databaseConfiguration = resolveDatabaseConfiguration({
  DATABASE_URL: process.env.DATABASE_URL,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  TURSO_SYNC_URL: process.env.TURSO_SYNC_URL,
  TURSO_SYNC_INTERVAL_MS: process.env.TURSO_SYNC_INTERVAL_MS,
})
export const db = createClient(databaseConfiguration.client)

export function createUserId(): string {
  return crypto.randomUUID()
}

export async function insertAdminUser(params: {
  readonly username: string
  readonly passwordHash: string
}): Promise<string> {
  const id = createUserId()
  await executeWrite({
    sql: `INSERT INTO "user" (
			id, name, email, email_verified, username, role, auth_method, is_active, password_hash
		) VALUES (?, ?, ?, 1, ?, ?, ?, 1, ?)`,
    args: [
      id,
      params.username,
      hiveAuthEmail(params.username),
      params.username,
      UserRole.Admin,
      'password',
      params.passwordHash,
    ],
  })
  return id
}

interface TransactionContext {
  readonly transaction: Transaction
  readonly mode: 'read' | 'write'
}

const transactionContext = new AsyncLocalStorage<TransactionContext>()
let databaseOperationQueue: Promise<void> = Promise.resolve()

async function withDatabaseOperationLock<T>(
  operation: () => Promise<T>
): Promise<T> {
  const previous = databaseOperationQueue
  let release!: () => void
  databaseOperationQueue = new Promise<void>(resolve => {
    release = resolve
  })
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

function sqliteLockCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null
  }
  const code = error.code
  return typeof code === 'string' ? code : null
}

async function retryTransientDatabaseLock<T>(
  operation: () => Promise<T>
): Promise<T> {
  const delaysMs = [20, 50, 100] as const
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const code = sqliteLockCode(error)
      if (
        attempt >= delaysMs.length ||
        (code !== 'SQLITE_BUSY' && code !== 'SQLITE_LOCKED')
      ) {
        throw error
      }
      await new Promise(resolve => setTimeout(resolve, delaysMs[attempt]))
    }
  }
}

async function beginTransactionWithLockRetry(
  mode: 'read' | 'write'
): Promise<Transaction> {
  return retryTransientDatabaseLock(() => db.transaction(mode))
}

/**
 * Execute one statement on the active dedicated transaction, or in the local
 * process queue. This queues reads as well as writes and never inspects SQL.
 */
export async function execute(statement: InStatement): Promise<ResultSet> {
  const context = transactionContext.getStore()
  return context
    ? context.transaction.execute(statement)
    : withDatabaseOperationLock(() =>
        retryTransientDatabaseLock(() => db.execute(statement))
      )
}

/** Mark an isolated mutation explicitly at its call site. */
export async function executeWrite(statement: InStatement): Promise<ResultSet> {
  return execute(statement)
}

/** Run related reads through one dedicated, coherent read transaction. */
export async function withReadSnapshot<T>(fn: () => Promise<T>): Promise<T> {
  const activeContext = transactionContext.getStore()
  if (activeContext) return fn()

  return withDatabaseOperationLock(async () => {
    const transaction = await beginTransactionWithLockRetry('read')
    try {
      const result = await transactionContext.run(
        { transaction, mode: 'read' },
        fn
      )
      await transaction.commit()
      return result
    } catch (error) {
      await transaction.rollback()
      throw error
    } finally {
      transaction.close()
    }
  })
}

/**
 * Execute a callback inside a SQLite transaction.
 * Nested calls in the same async context join the outer transaction.
 * Concurrent callers do not share that context.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const activeContext = transactionContext.getStore()
  if (activeContext?.mode === 'write') {
    return fn()
  }
  if (activeContext?.mode === 'read') {
    throw new Error('Cannot start a write transaction inside a read snapshot')
  }

  return withDatabaseOperationLock(async () => {
    const transaction = await beginTransactionWithLockRetry('write')
    try {
      const result = await transactionContext.run(
        { transaction, mode: 'write' },
        fn
      )
      await transaction.commit()
      return result
    } catch (error) {
      await transaction.rollback()
      throw error
    } finally {
      transaction.close()
    }
  })
}

const SCHEMA_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS DatabaseSchemaMetadata (
		singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
		schema_version INTEGER NOT NULL,
		applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,

  `INSERT INTO DatabaseSchemaMetadata (singleton, schema_version)
		VALUES (1, ${DATABASE_SCHEMA_VERSION})
		ON CONFLICT(singleton) DO NOTHING`,

  // AUTH ADMIN
  `CREATE TABLE IF NOT EXISTS "user" (
		id TEXT PRIMARY KEY NOT NULL,
		name TEXT NOT NULL,
		email TEXT NOT NULL UNIQUE,
		email_verified INTEGER NOT NULL DEFAULT 1,
		image TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		username TEXT NOT NULL UNIQUE,
		role TEXT NOT NULL CHECK (role = '${UserRole.Admin}'),
		auth_method TEXT NOT NULL CHECK (auth_method = 'password'),
		is_active INTEGER NOT NULL DEFAULT 1,
		password_hash TEXT NOT NULL
	)`,

  `CREATE TABLE IF NOT EXISTS session (
		id TEXT PRIMARY KEY NOT NULL,
		expires_at DATETIME NOT NULL,
		token TEXT NOT NULL UNIQUE,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL,
		ip_address TEXT,
		user_agent TEXT,
		user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE
	)`,

  `CREATE TABLE IF NOT EXISTS account (
		id TEXT PRIMARY KEY NOT NULL,
		account_id TEXT NOT NULL,
		provider_id TEXT NOT NULL,
		user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE CASCADE,
		access_token TEXT,
		refresh_token TEXT,
		id_token TEXT,
		access_token_expires_at DATETIME,
		refresh_token_expires_at DATETIME,
		scope TEXT,
		password TEXT,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL
	)`,

  `CREATE TABLE IF NOT EXISTS verification (
		id TEXT PRIMARY KEY NOT NULL,
		identifier TEXT NOT NULL,
		value TEXT NOT NULL,
		expires_at DATETIME NOT NULL,
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL
	)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_single_admin ON "user"(role) WHERE role = '${UserRole.Admin}'`,

  // AUTH BUILDER
  `CREATE TABLE IF NOT EXISTS BuilderAuthChallenges (
		username TEXT PRIMARY KEY NOT NULL,
		nonce_hash TEXT NOT NULL UNIQUE,
		message TEXT NOT NULL,
		expires_at INTEGER NOT NULL
	)`,

  `CREATE TABLE IF NOT EXISTS BlockedHiveAccounts (
		hive_username TEXT PRIMARY KEY NOT NULL,
		reason TEXT,
		blocked_by TEXT NOT NULL,
		blocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,

  // BUSINESS
  `CREATE TABLE IF NOT EXISTS Tickets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT UNIQUE NOT NULL,
		description TEXT,
		total_uses INTEGER NOT NULL DEFAULT 1 CHECK (total_uses >= 1),
		remaining_uses INTEGER NOT NULL DEFAULT 1 CHECK (remaining_uses >= 0 AND remaining_uses <= total_uses),
		creator_username TEXT NOT NULL,
		funding_source TEXT NOT NULL CHECK (funding_source IN ('builder_credits', 'system')),
		owner_builder_username TEXT,
		issuer_admin_id TEXT REFERENCES "user" (id) ON DELETE RESTRICT,
		archived_at DATETIME,
		retired_uses INTEGER NOT NULL DEFAULT 0 CHECK (retired_uses >= 0 AND retired_uses + remaining_uses <= total_uses),
		revoked_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		CHECK (
			(funding_source = 'builder_credits' AND owner_builder_username IS NOT NULL AND issuer_admin_id IS NULL)
			OR (funding_source = 'system' AND owner_builder_username IS NULL AND issuer_admin_id IS NOT NULL)
		)
	)`,

  `CREATE TABLE IF NOT EXISTS Accounts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		creation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
		ticket TEXT NOT NULL,
		ticket_id INTEGER NOT NULL REFERENCES Tickets (id) ON DELETE RESTRICT,
		builder_username TEXT,
		registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		execution_mode TEXT NOT NULL CHECK (execution_mode IN ('${HIVE_TX_MODE_VALUES.SIMULATE}', '${HIVE_TX_MODE_VALUES.BROADCAST}')),
		blockchain_status TEXT NOT NULL CHECK (blockchain_status IN ('${BLOCKCHAIN_STATUS.SIMULATED}', '${BLOCKCHAIN_STATUS.BROADCASTED}', '${BLOCKCHAIN_STATUS.CONFIRMED}', '${BLOCKCHAIN_STATUS.FAILED}')),
		transaction_id TEXT,
		correlation_id TEXT,
		wax_status TEXT,
		rc_delegated INTEGER NOT NULL CHECK (rc_delegated IN (0, 1)),
		rc_status TEXT NOT NULL CHECK (rc_status IN ('${RC_STATUS.PENDING}', '${RC_STATUS.PROCESSING}', '${RC_STATUS.UNCERTAIN}', '${RC_STATUS.DELEGATED}')),
		rc_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		rc_lease_token TEXT UNIQUE,
		rc_lease_expires_at DATETIME,
		rc_lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (rc_lease_generation >= 0),
		CHECK (
			(rc_lease_token IS NULL AND rc_lease_expires_at IS NULL)
			OR (rc_lease_token IS NOT NULL AND rc_lease_expires_at IS NOT NULL)
		),
		CHECK (
			(rc_status = '${RC_STATUS.PROCESSING}' AND rc_lease_token IS NOT NULL)
			OR (rc_status != '${RC_STATUS.PROCESSING}' AND rc_lease_token IS NULL)
		)
	)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_correlation_unique
		ON Accounts (correlation_id) WHERE correlation_id IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS TicketAudit (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticket TEXT NOT NULL,
		ticket_id INTEGER NOT NULL REFERENCES Tickets (id) ON DELETE RESTRICT,
		action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete', 'uses_adjusted', 'revoked', 'restored', 'archived')),
		actor_type TEXT NOT NULL CHECK (actor_type IN ('builder', 'admin', 'system')),
		actor_id TEXT NOT NULL,
		delta INTEGER,
		before_uses INTEGER,
		after_uses INTEGER,
		before_state TEXT,
		after_state TEXT,
		operation_reference TEXT NOT NULL UNIQUE,
		performed_by TEXT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,

  `CREATE TABLE IF NOT EXISTS Credits (
		hive_username TEXT PRIMARY KEY NOT NULL,
		pending_amount INTEGER NOT NULL DEFAULT 0 CHECK (pending_amount >= 0),
		available_amount INTEGER NOT NULL DEFAULT 0 CHECK (available_amount >= 0),
		total_issued INTEGER NOT NULL DEFAULT 0 CHECK (total_issued >= 0),
		total_consumed INTEGER NOT NULL DEFAULT 0 CHECK (total_consumed >= 0),
		revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,

  ADMIN_ACTION_LOG_TABLE_SQL,

  `CREATE TABLE IF NOT EXISTS CreditAudit (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		hive_username TEXT NOT NULL,
		operation TEXT NOT NULL,
		amount INTEGER NOT NULL,
		reason TEXT,
		performed_by TEXT,
		external_reference TEXT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,

  `CREATE TABLE IF NOT EXISTS CreditClaimIntents (
		hash TEXT PRIMARY KEY NOT NULL CHECK (length(hash) = 64),
		hive_username TEXT NOT NULL CHECK (length(hive_username) > 0),
		amount INTEGER NOT NULL CHECK (amount > 0),
		created_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL CHECK (expires_at > created_at)
	)`,

  `CREATE TABLE IF NOT EXISTS LoginAttempts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		role TEXT,
		auth_method TEXT NOT NULL CHECK (auth_method IN ('password', 'keychain')),
		success BOOLEAN NOT NULL,
		ip_address TEXT,
		user_agent TEXT,
		error_message TEXT,
		attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,

  `CREATE TABLE IF NOT EXISTS Notifications (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		hive_username TEXT NOT NULL,
		type TEXT NOT NULL CHECK (type IN ('pending_credits', 'account_created', 'credit_assigned', 'system')),
		title TEXT NOT NULL,
		message TEXT NOT NULL,
		metadata TEXT,
		is_read BOOLEAN DEFAULT FALSE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		read_at DATETIME,
		viewed_at DATETIME
	)`,

  // BLOCKCHAIN RECOVERY
  `CREATE TABLE IF NOT EXISTS CreationAttempts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		correlation_id TEXT NOT NULL UNIQUE,
		username TEXT NOT NULL,
		ticket TEXT NOT NULL,
		ticket_id INTEGER NOT NULL REFERENCES Tickets (id) ON DELETE RESTRICT,
		funding_source TEXT NOT NULL CHECK (funding_source IN ('builder_credits', 'system')),
		owner_builder_username TEXT,
		version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
		lease_token TEXT UNIQUE,
		lease_expires_at DATETIME,
		lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
		status TEXT NOT NULL CHECK (status IN ('reserved', 'prepared', 'broadcasting', 'completed', 'rolled_back')),
		owner_public_key TEXT NOT NULL,
		active_public_key TEXT NOT NULL,
		posting_public_key TEXT NOT NULL,
		memo_public_key TEXT NOT NULL,
		transaction_id TEXT,
		transaction_expires_at TEXT,
		execution_mode TEXT NOT NULL CHECK (execution_mode IN ('${HIVE_TX_MODE_VALUES.SIMULATE}', '${HIVE_TX_MODE_VALUES.BROADCAST}')),
		broadcasted INTEGER NOT NULL DEFAULT 0,
		wax_validated INTEGER NOT NULL DEFAULT 0,
		wax_on_chain_verified INTEGER NOT NULL DEFAULT 0,
		wax_signed INTEGER NOT NULL DEFAULT 0,
		wax_authority_verified INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		CHECK (
			(funding_source = 'builder_credits' AND owner_builder_username IS NOT NULL)
			OR (funding_source = 'system' AND owner_builder_username IS NULL)
		),
		CHECK (
			(lease_token IS NULL AND lease_expires_at IS NULL)
			OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
		),
		CHECK (
			status IN ('reserved', 'prepared', 'broadcasting')
			OR lease_token IS NULL
		),
		CHECK (
			status != 'broadcasting'
			OR (transaction_id IS NOT NULL AND transaction_expires_at IS NOT NULL)
		)
	)`,

  `CREATE TABLE IF NOT EXISTS CreationAttemptEvents (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		correlation_id TEXT NOT NULL REFERENCES CreationAttempts (correlation_id) ON DELETE RESTRICT,
		ticket_id INTEGER NOT NULL REFERENCES Tickets (id) ON DELETE RESTRICT,
		username TEXT NOT NULL,
		event_type TEXT NOT NULL CHECK (event_type IN (
			'${CREATION_ATTEMPT_EVENT_TYPES.RESERVED}',
			'${CREATION_ATTEMPT_EVENT_TYPES.PREPARED}',
			'${CREATION_ATTEMPT_EVENT_TYPES.BROADCAST_AUTHORIZED}',
			'${CREATION_ATTEMPT_EVENT_TYPES.BROADCAST_RESULT}',
			'${CREATION_ATTEMPT_EVENT_TYPES.COMPLETED}',
			'${CREATION_ATTEMPT_EVENT_TYPES.ROLLED_BACK}'
		)),
		from_status TEXT,
		to_status TEXT NOT NULL CHECK (to_status IN ('reserved', 'prepared', 'broadcasting', 'completed', 'rolled_back')),
		version INTEGER NOT NULL CHECK (version >= 0),
		lease_generation INTEGER NOT NULL CHECK (lease_generation >= 0),
		transaction_id TEXT,
		detail_json TEXT,
		operation_reference TEXT NOT NULL UNIQUE,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,

  `CREATE TABLE IF NOT EXISTS ReconciliationQueue (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		correlation_id TEXT NOT NULL UNIQUE,
		username TEXT NOT NULL,
		ticket_code TEXT NOT NULL,
		reason TEXT NOT NULL CHECK (reason IN ('ambiguous_chain_error', 'db_completion_failed')),
		error_category TEXT,
		error_message TEXT,
		transaction_id TEXT,
		resolved BOOLEAN DEFAULT FALSE,
		resolved_at DATETIME,
		resolved_by TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'processing', 'resolved', 'failed', 'manual_review')),
		attempt_count INTEGER DEFAULT 0 NOT NULL,
		last_error TEXT,
		processing_since DATETIME,
		next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		lease_token TEXT UNIQUE,
		lease_expires_at DATETIME,
		lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
		CHECK (
			(lease_token IS NULL AND lease_expires_at IS NULL)
			OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
		),
		CHECK (
			(status = 'processing' AND lease_token IS NOT NULL)
			OR (status != 'processing' AND lease_token IS NULL)
		),
		CHECK (
			(status = 'resolved' AND resolved = TRUE)
			OR (status != 'resolved' AND resolved = FALSE)
		)
	)`,

  `CREATE INDEX IF NOT EXISTS idx_user_username ON "user" (username)`,
  `CREATE INDEX IF NOT EXISTS idx_session_user ON session (user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_builder_auth_challenges_expires ON BuilderAuthChallenges (expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_creator ON Tickets (creator_username)`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_builder_username ON Accounts (builder_username)`,
  `CREATE INDEX IF NOT EXISTS idx_credit_audit_username ON CreditAudit (hive_username, timestamp DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_audit_external_reference
		ON CreditAudit (external_reference)
		WHERE external_reference IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_credit_claim_intents_expires
		ON CreditClaimIntents (expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON LoginAttempts (username)`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON LoginAttempts (attempted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_failed ON LoginAttempts (success, attempted_at) WHERE success = 0`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_failed ON LoginAttempts (ip_address, success, attempted_at) WHERE success = 0`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON Notifications (hive_username, is_read, created_at DESC) WHERE is_read = FALSE`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_all ON Notifications (hive_username, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliation_pending ON ReconciliationQueue (resolved, created_at DESC) WHERE resolved = FALSE`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliation_actionable ON ReconciliationQueue (status, next_attempt_at, id)`,
  `CREATE INDEX IF NOT EXISTS idx_creation_attempts_ticket ON CreationAttempts (ticket_id, username)`,
  `CREATE INDEX IF NOT EXISTS idx_creation_attempt_events_ticket ON CreationAttemptEvents (ticket_id, created_at)`,
  ...ADMIN_ACTION_LOG_INDEX_STATEMENTS,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_creation_attempts_open_username
		ON CreationAttempts (username) WHERE status IN ('reserved', 'prepared', 'broadcasting')`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_broadcasted ON Accounts (blockchain_status) WHERE blockchain_status = 'broadcasted'`,
]

async function assertExistingSchemaCompatible(): Promise<void> {
  const tableResult = await execute({
    sql: `SELECT name FROM sqlite_master WHERE type = 'table'`,
    args: [],
  })
  const tables = new Set(tableResult.rows.map(row => String(row.name)))
  if (!hasUserTables(tables)) return

  const columnsByTable = new Map<string, ReadonlySet<string>>()
  for (const table of Object.keys(REQUIRED_DATABASE_COLUMNS)) {
    if (!tables.has(table)) continue
    const result = await execute({
      sql: `PRAGMA table_info(${table})`,
      args: [],
    })
    columnsByTable.set(table, new Set(result.rows.map(row => String(row.name))))
  }

  const gaps = findDatabaseSchemaGaps({ tables, columnsByTable })
  if (gaps.missingTables.length > 0 || gaps.missingColumns.length > 0) {
    throw new Error(
      `Existing database schema is incompatible; missing tables [${gaps.missingTables.join(', ')}], missing columns [${gaps.missingColumns.join(', ')}]. Run pnpm db:diagnose and prepare an offline conversion.`
    )
  }
  const schemaVersionRow = await execute({
    sql: 'SELECT schema_version FROM DatabaseSchemaMetadata WHERE singleton = 1',
    args: [],
  })
  const schemaVersion = Number(schemaVersionRow.rows[0]?.schema_version)
  if (schemaVersion !== DATABASE_SCHEMA_VERSION) {
    throw new Error(
      `Existing database schema version ${Number.isFinite(schemaVersion) ? schemaVersion : 'missing'} is incompatible with required version ${DATABASE_SCHEMA_VERSION}. Run pnpm db:diagnose and prepare an offline conversion.`
    )
  }
}

/** Apply the current schema to an empty or already compatible database. */
export async function initializeDatabase(): Promise<boolean> {
  try {
    await executeWrite({ sql: 'PRAGMA foreign_keys = ON', args: [] })
    const foreignKeys = await execute({ sql: 'PRAGMA foreign_keys', args: [] })
    if (Number(foreignKeys.rows[0]?.foreign_keys) !== 1) {
      throw new Error('Database connection does not enforce foreign keys')
    }
    await assertExistingSchemaCompatible()
    await withTransaction(async () => {
      for (const sql of SCHEMA_STATEMENTS) {
        await executeWrite({ sql, args: [] })
      }
    })
    return true
  } catch (error) {
    logger.error('Database initialization error:', error)
    return false
  }
}
