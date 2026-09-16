/**
 * 🔗 ACCOUNTS REPOSITORY
 *
 * Centralizes all database operations related to created accounts.
 * Manages the registry of Hive accounts created in the system.
 *
 * Responsibilities:
 * - Basic account CRUD
 * - Specialized queries (by ticket, by date, by username)
 * - Complex queries with JOINs (accounts with ticket information)
 * - Created accounts statistics
 */

import { db } from '@/lib/database'

const ACCOUNT_COLUMNS =
  'id, username, creation_date, ticket, builder_username, registered_at, execution_mode, blockchain_status, transaction_id, correlation_id, wax_status, rc_status, rc_delegated'
// Logger removed
import {
  parseAccountRow,
  compactMap,
  type DatabaseAccountRow,
  type CreateAccountData,
} from '@/types/database'

/**
 * Account statistics
 */
export interface AccountStats {
  readonly totalAccounts: number
  readonly accountsToday: number
  readonly accountsThisWeek: number
  readonly accountsThisMonth: number
}

/**
 * Filters for account search
 */
export interface AccountFilters {
  readonly ticket?: string
  readonly usernamePattern?: string
  readonly dateFrom?: string
  readonly dateTo?: string
  readonly builderId?: number
}

export class AccountsRepository {
  // ===== BASIC CRUD =====

  /**
   * Create a new account (register created account)
   */
  async create(data: CreateAccountData): Promise<DatabaseAccountRow> {
    try {
      const result = await db.execute({
        sql: `
					INSERT INTO Accounts (
						username, ticket, builder_username, creation_date, registered_at,
						execution_mode, blockchain_status, transaction_id, correlation_id,
						wax_status, rc_status, rc_delegated
					)
					VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)
					RETURNING *
				`,
        args: [
          data.username,
          data.ticket,
          data.builder_username ?? '',
          new Date().toISOString(),
          data.execution_mode,
          data.blockchain_status,
          data.transaction_id ?? null,
          data.correlation_id ?? null,
          data.wax_status ?? null,
          data.rc_status,
          data.rc_delegated,
        ],
      })

      if (result.rows.length === 0) {
        throw new Error('Could not create account')
      }

      const account = parseAccountRow(result.rows[0])

      if (!account) {
        throw new Error('Error parsing created account')
      }

      return account
    } catch (error) {
      throw error
    }
  }

  /**
   * Get account by ID
   */
  async findById(id: number): Promise<DatabaseAccountRow | null> {
    try {
      const result = await db.execute({
        sql: `SELECT ${ACCOUNT_COLUMNS} FROM Accounts WHERE id = ?`,
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
   * Get account by username (unique)
   */
  async findByUsername(username: string): Promise<DatabaseAccountRow | null> {
    try {
      const result = await db.execute({
        sql: `SELECT ${ACCOUNT_COLUMNS} FROM Accounts WHERE username = ?`,
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
   * Check if an account exists with a username
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
   * Delete account by ID
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

  // ===== SPECIALIZED QUERIES =====

  /**
   * Get all accounts created with a specific ticket
   */
  async findByTicket(ticketCode: string): Promise<DatabaseAccountRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT ${ACCOUNT_COLUMNS} FROM Accounts
					WHERE ticket = ?
					ORDER BY creation_date DESC
				`,
        args: [ticketCode],
      })

      return compactMap(result.rows, parseAccountRow)
    } catch (error) {
      throw error
    }
  }

  /**
   * Get accounts created within a date range
   */
  async findByDateRange(
    from: string,
    to: string
  ): Promise<DatabaseAccountRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT ${ACCOUNT_COLUMNS} FROM Accounts
					WHERE DATE(creation_date) BETWEEN DATE(?) AND DATE(?)
					ORDER BY creation_date DESC
				`,
        args: [from, to],
      })

      return compactMap(result.rows, parseAccountRow)
    } catch (error) {
      throw error
    }
  }

  /**
   * Get all accounts
   */
  async getAll(): Promise<DatabaseAccountRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT ${ACCOUNT_COLUMNS} FROM Accounts
					ORDER BY creation_date DESC
				`,
        args: [],
      })

      return compactMap(result.rows, parseAccountRow)
    } catch (error) {
      throw error
    }
  }

  /**
   * Get recent accounts (last N)
   */
  async getRecent(limit: number = 5): Promise<DatabaseAccountRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT ${ACCOUNT_COLUMNS} FROM Accounts
					ORDER BY creation_date DESC
					LIMIT ?
				`,
        args: [limit],
      })

      return compactMap(result.rows, parseAccountRow)
    } catch (error) {
      throw error
    }
  }

  /**
   * Search accounts by username pattern
   */
  async searchByUsername(pattern: string): Promise<DatabaseAccountRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT ${ACCOUNT_COLUMNS} FROM Accounts
					WHERE username LIKE ?
					ORDER BY creation_date DESC
				`,
        args: [`%${pattern}%`],
      })

      return compactMap(result.rows, parseAccountRow)
    } catch (error) {
      throw error
    }
  }

  /**
   * Search accounts with multiple filters
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

      // If filtering by builder, we need a JOIN with Tickets
      if (filters.builderId) {
        conditions.push(
          'EXISTS (SELECT 1 FROM Tickets WHERE Tickets.code = Accounts.ticket AND Tickets.creator_username = ?)'
        )
        args.push(filters.builderId)
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const sql = `
				SELECT ${ACCOUNT_COLUMNS} FROM Accounts
				${whereClause}
				ORDER BY creation_date DESC
			`

      const result = await db.execute({ sql, args })

      return compactMap(result.rows, parseAccountRow)
    } catch (error) {
      throw error
    }
  }

  // ===== STATISTICS AND AGGREGATIONS =====

  /**
   * Get total account count
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
   * Get count of accounts created today
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
   * Get complete account statistics
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
   * Get count of accounts by builder
   */
  async countByBuilder(builderId: number): Promise<number> {
    try {
      const result = await db.execute({
        sql: `
					SELECT COUNT(*) as total
					FROM Accounts a
					JOIN Tickets t ON a.ticket = t.code
					WHERE t.creator_username = ?
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
