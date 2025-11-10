import { createClient } from '@libsql/client'

export const db = createClient({
  url: 'file:holahive.db',
})

// Inicializar base de datos
export async function initializeDatabase() {
  try {
    // Crear tabla Admins (solo 1 admin permitido)
    await db.execute(`
			CREATE TABLE IF NOT EXISTS Admins (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				username TEXT UNIQUE NOT NULL,
				password_hash TEXT NOT NULL,
				is_active BOOLEAN DEFAULT TRUE,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`)

    // Crear tabla Builders (usuarios que crean cuentas vía Keychain)
    await db.execute(`
			CREATE TABLE IF NOT EXISTS Builders (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				hive_username TEXT UNIQUE NOT NULL,
				is_active BOOLEAN DEFAULT TRUE,
				last_claim_at DATETIME,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`)
    // Crear tabla Tickets (nueva versión con estados automáticos)
    await db.execute(`
			CREATE TABLE IF NOT EXISTS Tickets (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				code TEXT UNIQUE NOT NULL,
				type TEXT DEFAULT 'regular' CHECK (type IN ('regular', 'admin')),
				description TEXT,
				original_credits INTEGER DEFAULT 1,
				credits INTEGER DEFAULT 1,
				is_active BOOLEAN GENERATED ALWAYS AS (credits > 0) VIRTUAL,
				has_been_used BOOLEAN GENERATED ALWAYS AS (original_credits > credits) VIRTUAL,
				created_by_builder INTEGER,
				created_by_admin INTEGER,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (created_by_builder) REFERENCES Builders (id),
				FOREIGN KEY (created_by_admin) REFERENCES Admins (id)
			)
		`)

    // Crear trigger para auto-reset de tickets cuando se actualice original_credits
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
			END;
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
				performed_by_builder INTEGER,
				performed_by_admin INTEGER,
				timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (performed_by_builder) REFERENCES Builders (id),
				FOREIGN KEY (performed_by_admin) REFERENCES Admins (id)
			)
		`)

    // Crear tabla AdminSessions
    await db.execute(`
			CREATE TABLE IF NOT EXISTS AdminSessions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				admin_id INTEGER NOT NULL,
				session_token TEXT UNIQUE NOT NULL,
				expires_at DATETIME NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (admin_id) REFERENCES Admins (id)
			)
		`)

    // Crear tabla BuilderSessions
    await db.execute(`
			CREATE TABLE IF NOT EXISTS BuilderSessions (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				builder_id INTEGER NOT NULL,
				session_token TEXT UNIQUE NOT NULL,
				expires_at DATETIME NOT NULL,
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (builder_id) REFERENCES Builders (id)
			)
		`)

    // Crear tabla Credits (sistema simplificado - 1 fila por builder)
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
				FOREIGN KEY (builder_id) REFERENCES Builders (id)
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
				performed_by_admin INTEGER,
				timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (builder_id) REFERENCES Builders (id),
				FOREIGN KEY (performed_by_admin) REFERENCES Admins (id)
			)
		`)

    // Trigger para prevenir crear más de 1 admin
    await db.execute(`
			CREATE TRIGGER IF NOT EXISTS prevent_multiple_admins
			BEFORE INSERT ON Admins
			WHEN (SELECT COUNT(*) FROM Admins) >= 1
			BEGIN
				SELECT RAISE(ABORT, 'Only one admin allowed');
			END;
		`)

    return true
  } catch (error) {
    return false
  }
}
