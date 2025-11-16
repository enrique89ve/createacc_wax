import { createClient } from '@libsql/client'

export const db = createClient({
  url: 'file:holahive.db',
})

// Inicializar base de datos
export async function initializeDatabase() {
  try {
    // Crear tabla Users (unificada - admins y builders)
    await db.execute(`
		CREATE TABLE IF NOT EXISTS Users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT,
			role TEXT NOT NULL CHECK (role IN ('admin', 'builder')),
			is_active BOOLEAN DEFAULT TRUE,
			last_claim_at DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)

    // Trigger: Solo 1 admin permitido
    await db.execute(`
		CREATE TRIGGER IF NOT EXISTS prevent_multiple_admins
		BEFORE INSERT ON Users
		WHEN NEW.role = 'admin' AND (SELECT COUNT(*) FROM Users WHERE role = 'admin') >= 1
		BEGIN
			SELECT RAISE(ABORT, 'Only one admin allowed');
		END
	`)

    // Trigger: Admin debe tener password, Builder no
    await db.execute(`
		CREATE TRIGGER IF NOT EXISTS enforce_admin_password_constraint
		BEFORE INSERT ON Users
		FOR EACH ROW
		WHEN (NEW.role = 'admin' AND NEW.password_hash IS NULL) OR
			(NEW.role = 'builder' AND NEW.password_hash IS NOT NULL)
		BEGIN
			SELECT RAISE(ABORT, 'Admin must have password_hash, Builder must not');
		END
	`)

    // Trigger: No cambiar role después de creación
    await db.execute(`
		CREATE TRIGGER IF NOT EXISTS prevent_role_change
		BEFORE UPDATE OF role ON Users
		FOR EACH ROW
		WHEN OLD.role != NEW.role
		BEGIN
			SELECT RAISE(ABORT, 'Cannot change user role after creation');
		END
	`)

    // Crear tabla Tickets (versión unificada)
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

    // Crear tabla Accounts
    await db.execute(`
		CREATE TABLE IF NOT EXISTS Accounts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			creation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
			ticket TEXT NOT NULL,
			registered_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)

    // Crear tabla TicketAudit
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

    // Crear tabla UserSessions (unificada)
    await db.execute(`
		CREATE TABLE IF NOT EXISTS UserSessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			session_token TEXT UNIQUE NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES Users (id)
		)
	`)

    // Crear tabla Credits
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

    // Crear tabla CreditAudit
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

    // Crear tabla LoginAttempts (auditoría de seguridad)
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

    // Índices para LoginAttempts
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

    return true
  } catch (error) {
    console.error('Database initialization error:', error)
    return false
  }
}
