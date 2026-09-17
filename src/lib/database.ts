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
import {
  BLOCKCHAIN_STATUS,
  HIVE_TX_MODE_VALUES,
  RC_STATUS,
} from '@/consts/hive-execution'

export const db = createClient({
  url: process.env.DATABASE_URL || 'file:holahive.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
  syncUrl: process.env.TURSO_SYNC_URL,
})

export function createUserId(): string {
  return crypto.randomUUID()
}

export async function insertAdminUser(params: {
  readonly username: string
  readonly passwordHash: string
}): Promise<string> {
  const id = createUserId()
  await db.execute({
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

const transactionContext = new AsyncLocalStorage<Transaction>()
let transactionQueue: Promise<void> = Promise.resolve()

/** Execute on the active dedicated transaction, or on the shared client. */
export async function execute(statement: InStatement): Promise<ResultSet> {
  const transaction = transactionContext.getStore()
  return transaction ? transaction.execute(statement) : db.execute(statement)
}

/**
 * Execute a callback inside a SQLite transaction.
 * Nested calls in the same async context join the outer transaction.
 * Concurrent callers do not share that context.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (transactionContext.getStore()) {
    return fn()
  }

  const previous = transactionQueue
  let release!: () => void
  transactionQueue = new Promise<void>(resolve => {
    release = resolve
  })
  await previous

  try {
    const transaction = await db.transaction('write')
    try {
      const result = await transactionContext.run(transaction, fn)
      await transaction.commit()
      return result
    } catch (error) {
      await transaction.rollback()
      throw error
    } finally {
      transaction.close()
    }
  } finally {
    release()
  }
}

const SCHEMA_STATEMENTS: readonly string[] = [
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
		revoked_at DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,

  `CREATE TABLE IF NOT EXISTS Accounts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		creation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
		ticket TEXT NOT NULL,
		builder_username TEXT NOT NULL,
		registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		execution_mode TEXT NOT NULL CHECK (execution_mode IN ('${HIVE_TX_MODE_VALUES.SIMULATE}', '${HIVE_TX_MODE_VALUES.BROADCAST}')),
		blockchain_status TEXT NOT NULL CHECK (blockchain_status IN ('${BLOCKCHAIN_STATUS.SIMULATED}', '${BLOCKCHAIN_STATUS.BROADCASTED}', '${BLOCKCHAIN_STATUS.CONFIRMED}', '${BLOCKCHAIN_STATUS.FAILED}')),
		transaction_id TEXT,
		correlation_id TEXT,
		wax_status TEXT,
		rc_delegated INTEGER NOT NULL CHECK (rc_delegated IN (0, 1)),
		rc_status TEXT NOT NULL CHECK (rc_status IN ('${RC_STATUS.PENDING}', '${RC_STATUS.PROCESSING}', '${RC_STATUS.UNCERTAIN}', '${RC_STATUS.DELEGATED}')),
		rc_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,

  `CREATE TABLE IF NOT EXISTS TicketAudit (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticket TEXT NOT NULL,
		action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
		performed_by TEXT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,

  `CREATE TABLE IF NOT EXISTS Credits (
		hive_username TEXT PRIMARY KEY NOT NULL,
		pending_amount INTEGER NOT NULL DEFAULT 0 CHECK (pending_amount >= 0),
		available_amount INTEGER NOT NULL DEFAULT 0 CHECK (available_amount >= 0),
		total_issued INTEGER NOT NULL DEFAULT 0 CHECK (total_issued >= 0),
		total_consumed INTEGER NOT NULL DEFAULT 0 CHECK (total_consumed >= 0),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,

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
		status TEXT NOT NULL CHECK (status IN ('reserved', 'prepared', 'broadcasting', 'completed', 'rolled_back')),
		owner_public_key TEXT NOT NULL,
		active_public_key TEXT NOT NULL,
		posting_public_key TEXT NOT NULL,
		memo_public_key TEXT NOT NULL,
		transaction_id TEXT,
		execution_mode TEXT NOT NULL CHECK (execution_mode IN ('${HIVE_TX_MODE_VALUES.SIMULATE}', '${HIVE_TX_MODE_VALUES.BROADCAST}')),
		broadcasted INTEGER NOT NULL DEFAULT 0,
		wax_validated INTEGER NOT NULL DEFAULT 0,
		wax_on_chain_verified INTEGER NOT NULL DEFAULT 0,
		wax_signed INTEGER NOT NULL DEFAULT 0,
		wax_authority_verified INTEGER NOT NULL DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`,

  `CREATE TABLE IF NOT EXISTS ReconciliationQueue (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		correlation_id TEXT NOT NULL,
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
		status TEXT DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'processing', 'resolved', 'failed', 'abandoned')),
		attempt_count INTEGER DEFAULT 0 NOT NULL,
		last_error TEXT,
		processing_since DATETIME
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
  `CREATE INDEX IF NOT EXISTS idx_reconciliation_actionable ON ReconciliationQueue (status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_creation_attempts_ticket ON CreationAttempts (ticket, username)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_creation_attempts_open_username
		ON CreationAttempts (username) WHERE status IN ('reserved', 'prepared', 'broadcasting')`,
  `CREATE INDEX IF NOT EXISTS idx_accounts_broadcasted ON Accounts (blockchain_status) WHERE blockchain_status = 'broadcasted'`,
]

/** Apply the current schema. Structural changes require `pnpm db:reset`. */
export async function initializeDatabase(): Promise<boolean> {
  try {
    for (const sql of SCHEMA_STATEMENTS) {
      await db.execute(sql)
    }
    return true
  } catch (error) {
    logger.error('Database initialization error:', error)
    return false
  }
}
