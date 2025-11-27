/**
 * 🔗 ACCOUNTS REPOSITORY
 *
 * Centraliza todas las operaciones de base de datos relacionadas con cuentas creadas.
 * Gestiona el registro de cuentas Hive creadas en el sistema.
 *
 * Responsabilidades:
 * - CRUD básico de cuentas
 * - Queries especializadas (por ticket, por fecha, por username)
 * - Queries complejas con JOINs (cuentas con información de tickets)
 * - Estadísticas de cuentas creadas
 */

import { db } from '@/lib/database'
// Logger removed
import {
  parseAccountRow,
  type DatabaseAccountRow,
  type CreateAccountData,
} from '@/types/database'

/**
 * Estadísticas de cuentas
 */
export interface AccountStats {
  readonly totalAccounts: number
  readonly accountsToday: number
  readonly accountsThisWeek: number
  readonly accountsThisMonth: number
}

/**
 * Filtros para búsqueda de cuentas
 */
export interface AccountFilters {
  readonly ticket?: string
  readonly usernamePattern?: string
  readonly dateFrom?: string
  readonly dateTo?: string
  readonly builderId?: number
}

export class AccountsRepository {
  // ===== CRUD BÁSICO =====

  /**
   * Crear una nueva cuenta (registrar cuenta creada)
   */
  async create(data: CreateAccountData): Promise<DatabaseAccountRow> {
    try {
      const result = await db.execute({
        sql: `
					INSERT INTO Accounts (username, ticket, ticket_by, creation_date, registered_at)
					VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
					RETURNING *
				`,
        args: [data.username, data.ticket, data.ticket_by ?? null, new Date().toISOString()],
      })

      if (result.rows.length === 0) {
        throw new Error('No se pudo crear la cuenta')
      }

      const account = parseAccountRow(result.rows[0])

      if (!account) {
        throw new Error('Error al parsear cuenta creada')
      }

      return account
    } catch (error) {
      throw error
    }
  }

  /**
   * Obtener cuenta por ID
   */
  async findById(id: number): Promise<DatabaseAccountRow | null> {
    try {
      const result = await db.execute({
        sql: 'SELECT id, username, creation_date, ticket, ticket_by, registered_at FROM Accounts WHERE id = ?',
        args: [id],
      })

      if (result.rows.length === 0) {
        return null
      }

      return parseAccountRow(result.rows[0])
    } catch (error) {
      throw error
    }
  }

  /**
   * Obtener cuenta por username (único)
   */
  async findByUsername(username: string): Promise<DatabaseAccountRow | null> {
    try {
      const result = await db.execute({
        sql: 'SELECT id, username, creation_date, ticket, ticket_by, registered_at FROM Accounts WHERE username = ?',
        args: [username],
      })

      if (result.rows.length === 0) {
        return null
      }

      return parseAccountRow(result.rows[0])
    } catch (error) {
      throw error
    }
  }

  /**
   * Verificar si existe una cuenta con un username
   */
  async existsByUsername(username: string): Promise<boolean> {
    try {
      const result = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM Accounts WHERE username = ?',
        args: [username],
      })

      return Number(result.rows[0]?.count || 0) > 0
    } catch (error) {
      throw error
    }
  }

  /**
   * Eliminar cuenta por ID
   */
  async delete(id: number): Promise<void> {
    try {
      await db.execute({
        sql: 'DELETE FROM Accounts WHERE id = ?',
        args: [id],
      })
    } catch (error) {
      throw error
    }
  }

  // ===== QUERIES ESPECIALIZADAS =====

  /**
   * Obtener todas las cuentas creadas con un ticket específico
   */
  async findByTicket(ticketCode: string): Promise<DatabaseAccountRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT id, username, creation_date, ticket, ticket_by, registered_at FROM Accounts
					WHERE ticket = ?
					ORDER BY creation_date DESC
				`,
        args: [ticketCode],
      })

      return result.rows
        .map(row => parseAccountRow(row))
        .filter((account): account is DatabaseAccountRow => account !== null)
    } catch (error) {
      throw error
    }
  }

  /**
   * Obtener cuentas creadas en un rango de fechas
   */
  async findByDateRange(
    from: string,
    to: string
  ): Promise<DatabaseAccountRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT id, username, creation_date, ticket, ticket_by, registered_at FROM Accounts
					WHERE DATE(creation_date) BETWEEN DATE(?) AND DATE(?)
					ORDER BY creation_date DESC
				`,
        args: [from, to],
      })

      return result.rows
        .map(row => parseAccountRow(row))
        .filter((account): account is DatabaseAccountRow => account !== null)
    } catch (error) {
      throw error
    }
  }

  /**
   * Obtener todas las cuentas
   */
  async getAll(): Promise<DatabaseAccountRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT id, username, creation_date, ticket, ticket_by, registered_at FROM Accounts
					ORDER BY creation_date DESC
				`,
        args: [],
      })

      return result.rows
        .map(row => parseAccountRow(row))
        .filter((account): account is DatabaseAccountRow => account !== null)
    } catch (error) {
      throw error
    }
  }

  /**
   * Obtener cuentas recientes (últimas N)
   */
  async getRecent(limit: number = 5): Promise<DatabaseAccountRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT id, username, creation_date, ticket, ticket_by, registered_at FROM Accounts
					ORDER BY creation_date DESC
					LIMIT ?
				`,
        args: [limit],
      })

      return result.rows
        .map(row => parseAccountRow(row))
        .filter((account): account is DatabaseAccountRow => account !== null)
    } catch (error) {
      throw error
    }
  }

  /**
   * Buscar cuentas por patrón de username
   */
  async searchByUsername(pattern: string): Promise<DatabaseAccountRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT id, username, creation_date, ticket, ticket_by, registered_at FROM Accounts
					WHERE username LIKE ?
					ORDER BY creation_date DESC
				`,
        args: [`%${pattern}%`],
      })

      return result.rows
        .map(row => parseAccountRow(row))
        .filter((account): account is DatabaseAccountRow => account !== null)
    } catch (error) {
      throw error
    }
  }

  /**
   * Buscar cuentas con filtros múltiples
   */
  async findWithFilters(
    filters: AccountFilters
  ): Promise<DatabaseAccountRow[]> {
    try {
      const conditions: string[] = []
      const args: (string | number)[] = []

      if (filters.ticket) {
        conditions.push('ticket = ?')
        args.push(filters.ticket)
      }

      if (filters.usernamePattern) {
        conditions.push('username LIKE ?')
        args.push(`%${filters.usernamePattern}%`)
      }

      if (filters.dateFrom) {
        conditions.push('DATE(creation_date) >= DATE(?)')
        args.push(filters.dateFrom)
      }

      if (filters.dateTo) {
        conditions.push('DATE(creation_date) <= DATE(?)')
        args.push(filters.dateTo)
      }

      // Si se filtra por builder, necesitamos JOIN con Tickets
      if (filters.builderId) {
        conditions.push(
          'EXISTS (SELECT 1 FROM Tickets WHERE Tickets.code = Accounts.ticket AND Tickets.created_by = ?)'
        )
        args.push(filters.builderId)
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const sql = `
				SELECT id, username, creation_date, ticket, ticket_by, registered_at FROM Accounts
				${whereClause}
				ORDER BY creation_date DESC
			`

      const result = await db.execute({ sql, args })

      return result.rows
        .map(row => parseAccountRow(row))
        .filter((account): account is DatabaseAccountRow => account !== null)
    } catch (error) {
      throw error
    }
  }

  // ===== ESTADÍSTICAS Y AGREGACIONES =====

  /**
   * Obtener conteo total de cuentas
   */
  async countAll(): Promise<number> {
    try {
      const result = await db.execute({
        sql: 'SELECT COUNT(*) as total FROM Accounts',
        args: [],
      })

      return Number(result.rows[0]?.total || 0)
    } catch (error) {
      throw error
    }
  }

  /**
   * Obtener conteo de cuentas creadas hoy
   */
  async countToday(): Promise<number> {
    try {
      const result = await db.execute({
        sql: `
					SELECT COUNT(*) as total
					FROM Accounts
					WHERE DATE(creation_date) = DATE('now')
				`,
        args: [],
      })

      return Number(result.rows[0]?.total || 0)
    } catch (error) {
      throw error
    }
  }

  /**
   * Obtener estadísticas completas de cuentas
   */
  async getStats(): Promise<AccountStats> {
    try {
      const result = await db.execute({
        sql: `
					SELECT
						COUNT(*) as total_accounts,
						SUM(CASE WHEN DATE(creation_date) = DATE('now') THEN 1 ELSE 0 END) as accounts_today,
						SUM(CASE WHEN DATE(creation_date) >= DATE('now', '-7 days') THEN 1 ELSE 0 END) as accounts_this_week,
						SUM(CASE WHEN DATE(creation_date) >= DATE('now', 'start of month') THEN 1 ELSE 0 END) as accounts_this_month
					FROM Accounts
				`,
        args: [],
      })

      const row = result.rows[0] as Record<string, unknown>

      return {
        totalAccounts: Number(row.total_accounts || 0),
        accountsToday: Number(row.accounts_today || 0),
        accountsThisWeek: Number(row.accounts_this_week || 0),
        accountsThisMonth: Number(row.accounts_this_month || 0),
      }
    } catch (error) {
      throw error
    }
  }

  /**
   * Obtener conteo de cuentas por builder
   */
  async countByBuilder(builderId: number): Promise<number> {
    try {
      const result = await db.execute({
        sql: `
					SELECT COUNT(*) as total
					FROM Accounts a
					JOIN Tickets t ON a.ticket = t.code
					WHERE t.created_by = ?
				`,
        args: [builderId],
      })

      return Number(result.rows[0]?.total || 0)
    } catch (error) {
      throw error
    }
  }
}

// Singleton instance
export const accountsRepository = new AccountsRepository()
