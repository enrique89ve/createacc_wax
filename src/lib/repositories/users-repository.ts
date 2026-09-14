/**
 * 👥 USERS REPOSITORY
 *
 * Centralizes all database operations related to users (admins and builders).
 * Manages the unified Users table with 'admin' and 'builder' roles.
 *
 * Responsibilities:
 * - User CRUD (admins and builders)
 * - Specialized queries with statistics
 * - Avoids SQL code duplication across pages
 */

import { db, insertAppUser } from '@/lib/database'
import {
  parseUserRow,
  compactMap,
  type DatabaseUserRow,
  type CreateUserData,
  type UpdateUserData,
} from '@/types/database'
import { sqliteToBoolean } from '@/utils/sqlite-helpers'
import { UserRole } from '@/lib/roles'
import { toAccountStatusLabel } from '@/lib/account-status'

/**
 * Builder with ticket and credit statistics
 */
export interface BuilderWithStats {
  readonly id: string
  readonly hive_username: string
  readonly is_active: boolean
  readonly last_claim_at: string | null
  readonly created_at: string
  readonly tickets_created: number
  readonly available_credits: number
  readonly pending_credits: number
}

export class UsersRepository {
  // ===== BASIC CRUD =====

  /**
   * Create a new user (admin or builder)
   */
  async create({
    username,
    password_hash,
    role,
    is_active,
  }: CreateUserData): Promise<DatabaseUserRow> {
    const id = await insertAppUser({
      username,
      role,
      authMethod: role === UserRole.Admin ? 'password' : 'keychain',
      passwordHash: password_hash ?? null,
      isActive: is_active ?? true,
    })
    const createdUser = await this.getById(id)
    if (!createdUser) {
      throw new Error('Failed to create user')
    }
    return createdUser
  }

  /**
   * Get user by ID
   * SECURITY: Explicit columns - DO NOT include password_hash
   */
  async getById(id: string): Promise<DatabaseUserRow | null> {
    try {
      const result = await db.execute({
        sql: 'SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM "user" WHERE id = ?',
        args: [id],
      })

      if (result.rows.length === 0) {
        return null
      }

      return parseUserRow(result.rows[0])
    } catch (error) {
      return null
    }
  }

  /**
   * Get user by username
   * SECURITY: Explicit columns - DO NOT include password_hash
   */
  async getByUsername(username: string): Promise<DatabaseUserRow | null> {
    try {
      const result = await db.execute({
        sql: 'SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM "user" WHERE username = ?',
        args: [username],
      })

      if (result.rows.length === 0) {
        return null
      }

      return parseUserRow(result.rows[0])
    } catch (error) {
      return null
    }
  }

  /**
   * Update user
   */
  async update(
    id: string,
    data: UpdateUserData
  ): Promise<DatabaseUserRow | null> {
    try {
      const updates: string[] = []
      const args: Array<string | number | boolean | null> = []

      if (data.password_hash !== undefined) {
        updates.push('password_hash = ?')
        args.push(data.password_hash)
      }

      if (data.is_active !== undefined) {
        updates.push('is_active = ?')
        args.push(data.is_active)
      }

      if (data.last_claim_at !== undefined) {
        updates.push('last_claim_at = ?')
        args.push(data.last_claim_at)
      }

      if (updates.length === 0) {
        return this.getById(id)
      }

      updates.push('updated_at = CURRENT_TIMESTAMP')
      args.push(id)

      const result = await db.execute({
        sql: `
					UPDATE "user"
					SET ${updates.join(', ')}
					WHERE id = ?
					RETURNING *
				`,
        args,
      })

      if (result.rows.length === 0) {
        return null
      }

      return parseUserRow(result.rows[0])
    } catch (error) {
      return null
    }
  }

  // ===== SPECIALIZED QUERIES =====

  /**
   * Get all users with 'admin' role
   * SECURITY: Explicit columns - DO NOT include password_hash
   */
  async getAdmins(): Promise<DatabaseUserRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM "user"
					WHERE role = 'admin'
					ORDER BY created_at DESC
				`,
        args: [],
      })

      return compactMap(result.rows, parseUserRow)
    } catch (error) {
      return []
    }
  }

  /**
   * Get all users with 'builder' role
   * SECURITY: Explicit columns - DO NOT include password_hash
   */
  async getBuilders(): Promise<DatabaseUserRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM "user"
					WHERE role = 'builder'
					ORDER BY created_at DESC
				`,
        args: [],
      })

      return compactMap(result.rows, parseUserRow)
    } catch (error) {
      return []
    }
  }

  /**
   * Alias required by legacy endpoints that expect basic statistics
   */
  async getAllBuilders(): Promise<BuilderWithStats[]> {
    return this.getBuildersWithStats()
  }

  /**
   * Get builders with ticket and credit statistics
   * Used in management console
   */
  async getBuildersWithStats(): Promise<BuilderWithStats[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT
						u.id,
						u.username as hive_username,
						u.is_active,
						u.last_claim_at,
						u.created_at,
						COUNT(DISTINCT t.id) as tickets_created,
						COALESCE(MAX(c.available_amount), 0) as available_credits,
						COALESCE(MAX(c.pending_amount), 0) as pending_credits
					FROM "user" u
					LEFT JOIN Tickets t ON t.created_by = u.id
					LEFT JOIN Credits c ON c.builder_id = u.id
					WHERE u.role = 'builder'
					GROUP BY u.id, u.username, u.is_active, u.last_claim_at, u.created_at
					ORDER BY u.created_at DESC
				`,
        args: [],
      })

      return result.rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        hive_username: String(row.hive_username),
        is_active: sqliteToBoolean(row.is_active),
        last_claim_at: row.last_claim_at as string | null,
        created_at: String(row.created_at),
        tickets_created: Number(row.tickets_created || 0),
        available_credits: Number(row.available_credits || 0),
        pending_credits: Number(row.pending_credits || 0),
      }))
    } catch (error) {
      return []
    }
  }

  /**
   * Get count of users by role
   */
  async countByRole(role: 'admin' | 'builder'): Promise<number> {
    try {
      const result = await db.execute({
        sql: 'SELECT COUNT(*) as total FROM "user" WHERE role = ?',
        args: [role],
      })

      return Number(result.rows[0]?.total || 0)
    } catch (error) {
      return 0
    }
  }

  /**
   * Get total user count
   */
  async countAll(): Promise<number> {
    try {
      const result = await db.execute({
        sql: 'SELECT COUNT(*) as total FROM "user"',
        args: [],
      })

      return Number(result.rows[0]?.total || 0)
    } catch (error) {
      return 0
    }
  }

  /**
   * Check if an admin exists in the system
   */
  async hasAdmin(): Promise<boolean> {
    try {
      const count = await this.countByRole('admin')
      return count > 0
    } catch (error) {
      return false
    }
  }

  /**
   * Check if a username already exists
   */
  async usernameExists(username: string): Promise<boolean> {
    try {
      const user = await this.getByUsername(username)
      return user !== null
    } catch (error) {
      return false
    }
  }

  /**
   * Check builder existence by normalized username
   */
  async builderExistsByUsername(username: string): Promise<boolean> {
    try {
      const normalizedUsername = username.trim().toLowerCase()
      const result = await db.execute({
        sql: `
					SELECT 1
					FROM "user"
					WHERE role = 'builder' AND LOWER(username) = ?
					LIMIT 1
				`,
        args: [normalizedUsername],
      })

      return result.rows.length > 0
    } catch (error) {
      return false
    }
  }

  /**
   * Alias for compatibility with existing code
   */
  async findById(id: string): Promise<DatabaseUserRow | null> {
    return this.getById(id)
  }

  /**
   * Alias for compatibility with existing code
   */
  async findByUsername(username: string): Promise<DatabaseUserRow | null> {
    return this.getByUsername(username)
  }

  /**
   * Deactivate/Ban builder (Soft Delete)
   *
   * Instead of hard deleting, we mark as inactive to:
   * - Preserve unique ID (avoid collisions with new builders)
   * - Keep complete history intact (CreditAudit, TicketAudit, Accounts)
   * - Allow reactivation if necessary
   *
   * WHAT IT DOES:
   * - Mark user as is_active = false
   * - Deactivate all tickets (is_active = false)
   * - Set credits to 0 (pending and available)
   *
   * WHAT IT PRESERVES:
   * - User record (with is_active = false)
   * - All tickets (marked as inactive)
   * - Accounts: complete history of created accounts
   * - CreditAudit: complete credit history
   * - TicketAudit: complete ticket history
   */
  async deleteBuilderWithReferences(builderId: string): Promise<void> {
    await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

    try {
      // 1. Deactivate all tickets from builder (set credits to 0)
      // is_active is VIRTUAL column (credits > 0), cannot be written directly
      await db.execute({
        sql: 'UPDATE Tickets SET credits = 0, updated_at = CURRENT_TIMESTAMP WHERE created_by = ?',
        args: [builderId],
      })

      // 2. Set credits to 0 (but keep record for reference)
      await db.execute({
        sql: `UPDATE Credits 
              SET pending_amount = 0, 
                  available_amount = 0,
                  updated_at = CURRENT_TIMESTAMP 
              WHERE builder_id = ?`,
        args: [builderId],
      })

      // 3. Record in audit that the builder was deactivated
      await db.execute({
        sql: `INSERT INTO CreditAudit (
                builder_id, operation, amount, reason, timestamp
              ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        args: [
          builderId,
          'builder_deactivated',
          0,
          'Builder deactivated/banned by admin',
        ],
      })

      // 4. Mark user as inactive (Soft Delete)
      await db.execute({
        sql: `UPDATE "user" 
              SET is_active = 0, 
                  updated_at = CURRENT_TIMESTAMP 
              WHERE id = ? AND role = 'builder'`,
        args: [builderId],
      })

      await db.execute({ sql: 'COMMIT', args: [] })
    } catch (error) {
      await db.execute({ sql: 'ROLLBACK', args: [] })
      throw error
    }
  }

  /**
   * Reactivate a previously deactivated builder
   */
  async reactivateBuilder(builderId: string): Promise<void> {
    await db.execute({
      sql: `UPDATE "user" 
            SET is_active = 1, 
                updated_at = CURRENT_TIMESTAMP 
            WHERE id = ? AND role = 'builder'`,
      args: [builderId],
    })

    // Record in audit
    await db.execute({
      sql: `INSERT INTO CreditAudit (
              builder_id, operation, amount, reason, timestamp
            ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [
        builderId,
        'builder_reactivated',
        0,
        'Builder reactivated by admin',
      ],
    })
  }

  // ===== BUILDER SPECIFIC METHODS =====

  /**
   * Get accounts created by a specific builder (by ID)
   * Uses subquery to resolve username, avoiding a sequential getById() call.
   * Uses the ticket_by field from Accounts to show accounts even if the ticket was deleted.
   */
  async getAccountsByUser(builderId: string): Promise<AccountWithTicketInfo[]> {
    try {
      const result = await db.execute({
        sql: `SELECT
					a.id,
					a.username,
					a.ticket,
					a.creation_date,
					a.registered_at,
					a.ticket_by,
					a.blockchain_status,
					t.description as ticket_description,
					t.original_credits as ticket_original_credits,
					t.credits as ticket_remaining_credits
				FROM Accounts a
				LEFT JOIN Tickets t ON a.ticket = t.code
				WHERE a.ticket_by = (SELECT username FROM "user" WHERE id = ? LIMIT 1)
				ORDER BY a.creation_date DESC`,
        args: [builderId],
      })

      return result.rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        username: String(row.username),
        ticket: String(row.ticket),
        creation_date: String(row.creation_date),
        registered_at: String(row.registered_at),
        ticket_description: (row.ticket_description as string) || null,
        ticket_original_credits: Number(row.ticket_original_credits || 0),
        ticket_remaining_credits: Number(row.ticket_remaining_credits || 0),
        blockchain_status: String(row.blockchain_status || 'confirmed'),
        status_label: toAccountStatusLabel(String(row.blockchain_status || 'confirmed')),
      }))
    } catch (error) {
      return []
    }
  }

  /**
   * Get statistics of a specific builder (by ID)
   * Single query with subqueries — avoids 4 sequential round-trips.
   * Uses ticket_by to count accounts even if tickets were deleted.
   */
  async getBuildersStats(builderId: number): Promise<BuildersStats> {
    try {
      const result = await db.execute({
        sql: `SELECT
					(SELECT COUNT(*) FROM Accounts
					 WHERE ticket_by = (SELECT username FROM "user" WHERE id = ? LIMIT 1)
					) as total_accounts,
					(SELECT COUNT(*) FROM Tickets
					 WHERE created_by = ? AND is_active = 1
					) as active_tickets,
					(SELECT COALESCE(SUM(original_credits), 0) FROM Tickets
					 WHERE created_by = ? AND is_active = 1
					) as total_original,
					(SELECT COALESCE(SUM(credits), 0) FROM Tickets
					 WHERE created_by = ? AND is_active = 1
					) as total_remaining`,
        args: [builderId, builderId, builderId, builderId],
      })

      const row = result.rows[0] as Record<string, unknown> | undefined
      if (!row) {
        return {
          totalAccounts: 0,
          totalActiveTickets: 0,
          totalCreditsUsed: 0,
          totalCreditsRemaining: 0,
        }
      }

      const totalOriginal = Number(row.total_original || 0)
      const totalRemaining = Number(row.total_remaining || 0)

      return {
        totalAccounts: Number(row.total_accounts || 0),
        totalActiveTickets: Number(row.active_tickets || 0),
        totalCreditsUsed: totalOriginal - totalRemaining,
        totalCreditsRemaining: totalRemaining,
      }
    } catch (error) {
      return {
        totalAccounts: 0,
        totalActiveTickets: 0,
        totalCreditsUsed: 0,
        totalCreditsRemaining: 0,
      }
    }
  }
}

// ===== NECESSARY TYPES =====

/**
 * Account with ticket information
 */
export interface AccountWithTicketInfo {
  readonly id: number
  readonly username: string
  readonly ticket: string
  readonly creation_date: string
  readonly registered_at: string
  readonly ticket_description: string | null
  readonly ticket_original_credits: number
  readonly ticket_remaining_credits: number
  readonly blockchain_status: string
  readonly status_label: string
}

/**
 * Builder statistics
 */
export interface BuildersStats {
  readonly totalAccounts: number
  readonly totalActiveTickets: number
  readonly totalCreditsUsed: number
  readonly totalCreditsRemaining: number
}

// Singleton instance
export const usersRepository = new UsersRepository()
