import { createClient } from '@libsql/client'
import { UserRole } from '@/lib/roles'
import { logger } from '@/lib/logger'

export const db = createClient({
	url: process.env.DATABASE_URL || 'file:holahive.db',
	authToken: process.env.TURSO_AUTH_TOKEN,
	syncUrl: process.env.TURSO_SYNC_URL,
})

/**
 * Execute a callback inside a SQLite transaction.
 * Automatically issues BEGIN / COMMIT and ROLLBACK on error.
 *
 * WARNING: Do NOT nest — SQLite does not support concurrent transactions
 * on the same connection. Functions that already use their own
 * BEGIN/COMMIT (e.g. transferCredits, adjustCredits) must NOT be
 * called inside withTransaction.
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

// Initialize database
export async function initializeDatabase() {
  try {
    // Create Users table (unified - admins and builders)
    await db.execute(`
		CREATE TABLE IF NOT EXISTS Users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT,
			role TEXT NOT NULL CHECK (role IN ('${UserRole.Admin}', '${UserRole.Builder}')),
			is_active BOOLEAN DEFAULT TRUE,
			last_claim_at DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)

    // Trigger: Only 1 admin allowed
    await db.execute(`
		CREATE TRIGGER IF NOT EXISTS prevent_multiple_admins
		BEFORE INSERT ON Users
		WHEN NEW.role = '${UserRole.Admin}' AND (SELECT COUNT(*) FROM Users WHERE role = '${UserRole.Admin}') >= 1
		BEGIN
			SELECT RAISE(ABORT, 'Only one admin allowed');
		END
	`)

    // Trigger: Admin must have password, Builder must not
    await db.execute(`
		CREATE TRIGGER IF NOT EXISTS enforce_admin_password_constraint
		BEFORE INSERT ON Users
		FOR EACH ROW
		WHEN (NEW.role = '${UserRole.Admin}' AND NEW.password_hash IS NULL) OR
			(NEW.role = '${UserRole.Builder}' AND NEW.password_hash IS NOT NULL)
		BEGIN
			SELECT RAISE(ABORT, 'Admin must have password_hash, Builder must not');
		END
	`)

    // Trigger: Cannot change role after creation
    await db.execute(`
		CREATE TRIGGER IF NOT EXISTS prevent_role_change
		BEFORE UPDATE OF role ON Users
		FOR EACH ROW
		WHEN OLD.role != NEW.role
		BEGIN
			SELECT RAISE(ABORT, 'Cannot change user role after creation');
		END
	`)

    // Create Tickets table (unified version)
    await db.execute(`
		CREATE TABLE IF NOT EXISTS Tickets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			code TEXT UNIQUE NOT NULL,
			description TEXT,
			original_credits INTEGER DEFAULT 1,
			credits INTEGER DEFAULT 1,
			is_active BOOLEAN GENERATED ALWAYS AS (credits > 0) VIRTUAL,
			has_been_used BOOLEAN GENERATED ALWAYS AS (original_credits > credits) VIRTUAL,
			created_by INTEGER,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (created_by) REFERENCES Users (id)
		)
	`)

    // Trigger: Auto-reset tickets
    await db.execute(`
		CREATE TRIGGER IF NOT EXISTS auto_reset_ticket_on_original_credits_update
		AFTER UPDATE OF original_credits ON Tickets
		FOR EACH ROW
		WHEN NEW.original_credits != OLD.original_credits
		BEGIN
			UPDATE Tickets
			SET credits = NEW.original_credits,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = NEW.id;
		END
	`)

    // Create Accounts table
    await db.execute(`
		CREATE TABLE IF NOT EXISTS Accounts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			creation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
			ticket TEXT NOT NULL,
			ticket_by TEXT,
			registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)

    // Create TicketAudit table
    await db.execute(`
		CREATE TABLE IF NOT EXISTS TicketAudit (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			ticket TEXT NOT NULL,
			action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
			performed_by INTEGER,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (performed_by) REFERENCES Users (id)
		)
	`)

    // Create Credits table
    await db.execute(`
		CREATE TABLE IF NOT EXISTS Credits (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			builder_id INTEGER NOT NULL UNIQUE,
			pending_amount INTEGER DEFAULT 0 CHECK (pending_amount >= 0),
			available_amount INTEGER DEFAULT 0 CHECK (available_amount >= 0),
			total_assigned INTEGER DEFAULT 0 CHECK (total_assigned >= 0),
			total_consumed INTEGER DEFAULT 0 CHECK (total_consumed >= 0),
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (builder_id) REFERENCES Users (id)
		)
	`)

    // Create CreditAudit table
    await db.execute(`
		CREATE TABLE IF NOT EXISTS CreditAudit (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			builder_id INTEGER NOT NULL,
			operation TEXT NOT NULL,
			amount INTEGER NOT NULL,
			reason TEXT,
			performed_by INTEGER,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (builder_id) REFERENCES Users (id),
			FOREIGN KEY (performed_by) REFERENCES Users (id)
		)
	`)

    // Create LoginAttempts table (security audit)
    await db.execute(`
		CREATE TABLE IF NOT EXISTS LoginAttempts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL,
			role TEXT,
			auth_method TEXT NOT NULL CHECK (auth_method IN ('password', 'keychain')),
			success BOOLEAN NOT NULL,
			ip_address TEXT,
			user_agent TEXT,
			error_message TEXT,
			attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)

    // Indexes for LoginAttempts
    await db.execute(`
		CREATE INDEX IF NOT EXISTS idx_login_attempts_username
		ON LoginAttempts(username)
	`)

    await db.execute(`
		CREATE INDEX IF NOT EXISTS idx_login_attempts_attempted_at
		ON LoginAttempts(attempted_at)
	`)

    await db.execute(`
		CREATE INDEX IF NOT EXISTS idx_login_attempts_failed
		ON LoginAttempts(success, attempted_at)
		WHERE success = 0
	`)

    await db.execute(`
		CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_failed
		ON LoginAttempts(ip_address, success, attempted_at)
		WHERE success = 0
	`)

    // Create Notifications table
    await db.execute(`
		CREATE TABLE IF NOT EXISTS Notifications (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			type TEXT NOT NULL CHECK (type IN ('pending_credits', 'account_created', 'credit_assigned', 'system')),
			title TEXT NOT NULL,
			message TEXT NOT NULL,
			metadata TEXT,
			is_read BOOLEAN DEFAULT FALSE,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			read_at DATETIME,
			viewed_at DATETIME,
			FOREIGN KEY (user_id) REFERENCES Users (id) ON DELETE CASCADE
		)
	`)

    // Indexes for Notifications
    await db.execute(`
		CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
		ON Notifications(user_id, is_read, created_at DESC)
		WHERE is_read = FALSE
	`)

    await db.execute(`
		CREATE INDEX IF NOT EXISTS idx_notifications_user_all
		ON Notifications(user_id, created_at DESC)
	`)

    // Index for efficient cleanup of old notifications
    await db.execute(`
		CREATE INDEX IF NOT EXISTS idx_notifications_cleanup
		ON Notifications(user_id, is_read, viewed_at)
		WHERE viewed_at IS NOT NULL AND is_read = TRUE
	`)

    // Trigger: Auto-delete notifications when marked as read (optional)
    // Commented out by default - can be enabled for auto-cleanup
    /*
	await db.execute(`
		CREATE TRIGGER IF NOT EXISTS auto_delete_read_notifications
		AFTER UPDATE OF is_read ON Notifications
		FOR EACH ROW
		WHEN NEW.is_read = TRUE
		BEGIN
			DELETE FROM Notifications WHERE id = NEW.id;
		END
	`)
	*/

    // Trigger: Automatic cleanup of old notifications when marked as read
    await db.execute(`
		CREATE TRIGGER IF NOT EXISTS cleanup_old_read_notifications
		AFTER UPDATE OF is_read ON Notifications
		FOR EACH ROW
		WHEN NEW.is_read = TRUE AND NEW.viewed_at IS NOT NULL
		BEGIN
			DELETE FROM Notifications
			WHERE user_id = NEW.user_id
				AND is_read = TRUE
				AND viewed_at IS NOT NULL
				AND datetime(viewed_at, '+24 hours') <= datetime('now');
		END
	`)

    // Trigger: Automatic cleanup when inserting new notification
    await db.execute(`
		CREATE TRIGGER IF NOT EXISTS cleanup_on_new_notification
		AFTER INSERT ON Notifications
		FOR EACH ROW
		BEGIN
			DELETE FROM Notifications
			WHERE user_id = NEW.user_id
				AND is_read = TRUE
				AND viewed_at IS NOT NULL
				AND datetime(viewed_at, '+24 hours') <= datetime('now');
		END
	`)

    // Create ReconciliationQueue table (traceability of ambiguous operations)
    // NOTE: The CHECK on `status` only applies to new databases.
    // Existing databases get the column via ALTER TABLE (migration below) which
    // cannot add CHECK constraints in SQLite. All writes go through parameterized
    // functions using RECONCILIATION_STATUS constants, so this is safe in practice.
    await db.execute(`
		CREATE TABLE IF NOT EXISTS ReconciliationQueue (
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
		)
	`)

    await db.execute(`
		CREATE INDEX IF NOT EXISTS idx_reconciliation_pending
		ON ReconciliationQueue(resolved, created_at DESC)
		WHERE resolved = FALSE
	`)

    // --- Migration: add status-based reconciliation columns ---
    // Idempotent ALTER TABLE — ignore "duplicate column" errors
    const migrationColumns = [
      { sql: `ALTER TABLE ReconciliationQueue ADD COLUMN status TEXT DEFAULT 'pending' NOT NULL` },
      { sql: `ALTER TABLE ReconciliationQueue ADD COLUMN attempt_count INTEGER DEFAULT 0 NOT NULL` },
      { sql: `ALTER TABLE ReconciliationQueue ADD COLUMN last_error TEXT` },
      { sql: `ALTER TABLE ReconciliationQueue ADD COLUMN processing_since DATETIME` },
    ]
    for (const col of migrationColumns) {
      try {
        await db.execute(col.sql)
      } catch (e) {
        // Column already exists — safe to ignore
        const msg = e instanceof Error ? e.message : ''
        if (!msg.includes('duplicate column') && !msg.includes('already exists')) {
          logger.warn(`[db-migration] Non-critical ALTER TABLE warning: ${msg}`)
        }
      }
    }

    // Backfill: resolved=TRUE entries should have status='resolved'
    await db.execute(`
		UPDATE ReconciliationQueue
		SET status = 'resolved'
		WHERE resolved = TRUE AND status = 'pending'
	`)

    // Index for actionable entries (pending + failed)
    await db.execute(`
		CREATE INDEX IF NOT EXISTS idx_reconciliation_actionable
		ON ReconciliationQueue(status, created_at)
	`)

    // Trigger: Create notification when an account is created
    await db.execute(`
		CREATE TRIGGER IF NOT EXISTS notify_account_created
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
		END
	`)

    return true
  } catch (error) {
    logger.error('Database initialization error:', error)
    return false
  }
}
