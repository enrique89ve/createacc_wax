import { createClient } from '@libsql/client'
import { UserRole } from '@/lib/roles'
import { logger } from '@/lib/logger'
import { hiveAuthEmail } from '@/lib/auth-user'

export const db = createClient({
	url: process.env.DATABASE_URL || 'file:holahive.db',
	authToken: process.env.TURSO_AUTH_TOKEN,
	syncUrl: process.env.TURSO_SYNC_URL,
})

export function createUserId(): string {
	return crypto.randomUUID()
}

export function withUserEmail(username: string): string {
	return hiveAuthEmail(username)
}

export async function insertAppUser(params: {
	readonly username: string
	readonly role: UserRole
	readonly authMethod: 'password' | 'keychain'
	readonly passwordHash?: string | null
	readonly isActive?: boolean
}): Promise<string> {
	const id = createUserId()
	await db.execute({
		sql: `INSERT INTO "user" (
			id, name, email, email_verified, username, role, auth_method, is_active, password_hash
		) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
		args: [
			id,
			params.username,
			hiveAuthEmail(params.username),
			params.username,
			params.role,
			params.authMethod,
			params.isActive === false ? 0 : 1,
			params.passwordHash ?? null,
		],
	})
	return id
}

/**
 * Execute a callback inside a SQLite transaction.
 * Do not nest: SQLite does not support concurrent transactions on one connection.
 */
export async function withTransaction<T>(fn: () => Promise<T>): Promise<T> {
	await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })
	try {
		const result = await fn()
		await db.execute({ sql: 'COMMIT', args: [] })
		return result
	} catch (error) {
		await db.execute({ sql: 'ROLLBACK', args: [] })
		throw error
	}
}

const SCHEMA_STATEMENTS: readonly string[] = [
	`CREATE TABLE IF NOT EXISTS "user" (
		id TEXT PRIMARY KEY NOT NULL,
		name TEXT NOT NULL,
		email TEXT NOT NULL UNIQUE,
		email_verified INTEGER NOT NULL DEFAULT 1,
		image TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		username TEXT NOT NULL UNIQUE,
		role TEXT NOT NULL CHECK (role IN ('${UserRole.Admin}', '${UserRole.Builder}')),
		auth_method TEXT NOT NULL CHECK (auth_method IN ('password', 'keychain')),
		is_active INTEGER NOT NULL DEFAULT 1,
		password_hash TEXT,
		last_claim_at DATETIME
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

	`CREATE TABLE IF NOT EXISTS Tickets (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT UNIQUE NOT NULL,
		description TEXT,
		original_credits INTEGER DEFAULT 1,
		credits INTEGER DEFAULT 1,
		is_active BOOLEAN GENERATED ALWAYS AS (credits > 0) VIRTUAL,
		has_been_used BOOLEAN GENERATED ALWAYS AS (original_credits > credits) VIRTUAL,
		created_by TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (created_by) REFERENCES "user" (id)
	)`,

	`CREATE TABLE IF NOT EXISTS Accounts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		creation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
		ticket TEXT NOT NULL,
		ticket_by TEXT,
		registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		execution_mode TEXT NOT NULL DEFAULT 'broadcast',
		blockchain_status TEXT NOT NULL DEFAULT 'confirmed',
		transaction_id TEXT,
		correlation_id TEXT,
		wax_status TEXT,
		rc_delegated INTEGER NOT NULL DEFAULT 0
	)`,

	`CREATE TABLE IF NOT EXISTS TicketAudit (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		ticket TEXT NOT NULL,
		action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
		performed_by TEXT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (performed_by) REFERENCES "user" (id)
	)`,

	`CREATE TABLE IF NOT EXISTS Credits (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		builder_id TEXT NOT NULL UNIQUE,
		pending_amount INTEGER DEFAULT 0 CHECK (pending_amount >= 0),
		available_amount INTEGER DEFAULT 0 CHECK (available_amount >= 0),
		total_assigned INTEGER DEFAULT 0 CHECK (total_assigned >= 0),
		total_consumed INTEGER DEFAULT 0 CHECK (total_consumed >= 0),
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (builder_id) REFERENCES "user" (id)
	)`,

	`CREATE TABLE IF NOT EXISTS CreditAudit (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		builder_id TEXT NOT NULL,
		operation TEXT NOT NULL,
		amount INTEGER NOT NULL,
		reason TEXT,
		performed_by TEXT,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (builder_id) REFERENCES "user" (id),
		FOREIGN KEY (performed_by) REFERENCES "user" (id)
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
		user_id TEXT NOT NULL,
		type TEXT NOT NULL CHECK (type IN ('pending_credits', 'account_created', 'credit_assigned', 'system')),
		title TEXT NOT NULL,
		message TEXT NOT NULL,
		metadata TEXT,
		is_read BOOLEAN DEFAULT FALSE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		read_at DATETIME,
		viewed_at DATETIME,
		FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE CASCADE
	)`,

	`CREATE TABLE IF NOT EXISTS CreationAttempts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		correlation_id TEXT NOT NULL UNIQUE,
		username TEXT NOT NULL,
		ticket TEXT NOT NULL,
		status TEXT NOT NULL CHECK (status IN ('reserved', 'prepared', 'completed', 'rolled_back')),
		owner_public_key TEXT NOT NULL,
		active_public_key TEXT NOT NULL,
		posting_public_key TEXT NOT NULL,
		memo_public_key TEXT NOT NULL,
		transaction_id TEXT,
		execution_mode TEXT NOT NULL DEFAULT 'simulate',
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
	`CREATE INDEX IF NOT EXISTS idx_user_role ON "user" (role)`,
	`CREATE INDEX IF NOT EXISTS idx_session_user ON session (user_id)`,
	`CREATE INDEX IF NOT EXISTS idx_login_attempts_username ON LoginAttempts (username)`,
	`CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at ON LoginAttempts (attempted_at)`,
	`CREATE INDEX IF NOT EXISTS idx_login_attempts_failed ON LoginAttempts (success, attempted_at) WHERE success = 0`,
	`CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_failed ON LoginAttempts (ip_address, success, attempted_at) WHERE success = 0`,
	`CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON Notifications (user_id, is_read, created_at DESC) WHERE is_read = FALSE`,
	`CREATE INDEX IF NOT EXISTS idx_notifications_user_all ON Notifications (user_id, created_at DESC)`,
	`CREATE INDEX IF NOT EXISTS idx_notifications_cleanup ON Notifications (user_id, is_read, viewed_at) WHERE viewed_at IS NOT NULL AND is_read = TRUE`,
	`CREATE INDEX IF NOT EXISTS idx_reconciliation_pending ON ReconciliationQueue (resolved, created_at DESC) WHERE resolved = FALSE`,
	`CREATE INDEX IF NOT EXISTS idx_reconciliation_actionable ON ReconciliationQueue (status, created_at)`,
	`CREATE INDEX IF NOT EXISTS idx_creation_attempts_ticket ON CreationAttempts (ticket, username)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_creation_attempts_open_username
		ON CreationAttempts (username) WHERE status IN ('reserved', 'prepared')`,
	`CREATE INDEX IF NOT EXISTS idx_accounts_broadcasted ON Accounts (blockchain_status) WHERE blockchain_status = 'broadcasted'`,

	`CREATE TRIGGER IF NOT EXISTS prevent_multiple_admins
		BEFORE INSERT ON "user"
		WHEN NEW.role = '${UserRole.Admin}' AND (SELECT COUNT(*) FROM "user" WHERE role = '${UserRole.Admin}') >= 1
		BEGIN
			SELECT RAISE(ABORT, 'Only one admin allowed');
		END`,

	`CREATE TRIGGER IF NOT EXISTS enforce_admin_password_constraint
		BEFORE INSERT ON "user"
		FOR EACH ROW
		WHEN (NEW.role = '${UserRole.Admin}' AND NEW.password_hash IS NULL)
			OR (NEW.role = '${UserRole.Builder}' AND NEW.password_hash IS NOT NULL)
		BEGIN
			SELECT RAISE(ABORT, 'Admin must have password_hash, Builder must not');
		END`,

	`CREATE TRIGGER IF NOT EXISTS prevent_role_change
		BEFORE UPDATE OF role ON "user"
		FOR EACH ROW
		WHEN OLD.role != NEW.role
		BEGIN
			SELECT RAISE(ABORT, 'Cannot change user role after creation');
		END`,

	`CREATE TRIGGER IF NOT EXISTS auto_reset_ticket_on_original_credits_update
		AFTER UPDATE OF original_credits ON Tickets
		FOR EACH ROW
		WHEN NEW.original_credits != OLD.original_credits
		BEGIN
			UPDATE Tickets
			SET credits = NEW.original_credits,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = NEW.id;
		END`,

	`CREATE TRIGGER IF NOT EXISTS notify_account_created
		AFTER INSERT ON Accounts
		FOR EACH ROW
		BEGIN
			INSERT INTO Notifications (user_id, type, title, message, metadata)
			SELECT
				t.created_by,
				'account_created',
				'Cuenta Creada',
				'Se creó la cuenta @' || NEW.username || ' usando tu ticket',
				json_object('account_username', NEW.username, 'ticket_code', NEW.ticket)
			FROM Tickets t
			WHERE t.code = NEW.ticket
			AND t.created_by IS NOT NULL;
		END`,

	`CREATE TRIGGER IF NOT EXISTS cleanup_old_read_notifications
		AFTER UPDATE OF is_read ON Notifications
		FOR EACH ROW
		WHEN NEW.is_read = TRUE AND NEW.viewed_at IS NOT NULL
		BEGIN
			DELETE FROM Notifications
			WHERE user_id = NEW.user_id
				AND is_read = TRUE
				AND viewed_at IS NOT NULL
				AND datetime(viewed_at, '+24 hours') <= datetime('now');
		END`,

	`CREATE TRIGGER IF NOT EXISTS cleanup_on_new_notification
		AFTER INSERT ON Notifications
		FOR EACH ROW
		BEGIN
			DELETE FROM Notifications
			WHERE user_id = NEW.user_id
				AND is_read = TRUE
				AND viewed_at IS NOT NULL
				AND datetime(viewed_at, '+24 hours') <= datetime('now');
		END`,
]

const ACCOUNT_COLUMN_MIGRATIONS: readonly { name: string; sql: string }[] = [
	{
		name: 'execution_mode',
		sql: `ALTER TABLE Accounts ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'broadcast'`,
	},
	{
		name: 'blockchain_status',
		sql: `ALTER TABLE Accounts ADD COLUMN blockchain_status TEXT NOT NULL DEFAULT 'confirmed'`,
	},
	{
		name: 'transaction_id',
		sql: `ALTER TABLE Accounts ADD COLUMN transaction_id TEXT`,
	},
	{
		name: 'correlation_id',
		sql: `ALTER TABLE Accounts ADD COLUMN correlation_id TEXT`,
	},
	{
		name: 'wax_status',
		sql: `ALTER TABLE Accounts ADD COLUMN wax_status TEXT`,
	},
	{
		name: 'rc_delegated',
		sql: `ALTER TABLE Accounts ADD COLUMN rc_delegated INTEGER NOT NULL DEFAULT 0`,
	},
]

async function tableColumnNames(table: string): Promise<Set<string>> {
	const result = await db.execute(`PRAGMA table_info(${table})`)
	const names = new Set<string>()
	for (const row of result.rows) {
		const name = (row as { name?: unknown }).name
		if (typeof name === 'string') names.add(name)
	}
	return names
}

async function migrateAccountsSchema(): Promise<void> {
	const existing = await tableColumnNames('Accounts')
	for (const column of ACCOUNT_COLUMN_MIGRATIONS) {
		if (existing.has(column.name)) continue
		try {
			await db.execute(column.sql)
		} catch (error) {
			const message = error instanceof Error ? error.message : ''
			if (/duplicate column/i.test(message)) continue
			throw error
		}
	}
}

export async function initializeDatabase(): Promise<boolean> {
	try {
		for (const sql of SCHEMA_STATEMENTS) {
			await db.execute(sql)
		}
		await migrateAccountsSchema()
		return true
	} catch (error) {
		logger.error('Database initialization error:', error)
		return false
	}
}
