/**
 * Admin users in `"user"` plus credit-account listings keyed by Hive username.
 * Builders are not rows in `"user"`.
 */

import { execute, insertAdminUser } from '@/lib/database'
import {
  parseUserRow,
  compactMap,
  type DatabaseUserRow,
  type CreateUserData,
  type UpdateUserData,
} from '@/types/database'
import { UserRole } from '@/lib/roles'
import { toAccountStatusLabel } from '@/lib/account-status'

/**
 * Builder with ticket and credit statistics
 */
export interface BuilderWithStats {
  readonly id: string
  readonly hive_username: string
  readonly created_at: string
  readonly tickets_created: number
  readonly available_credits: number
  readonly pending_credits: number
  readonly is_blocked: boolean
}

export class UsersRepository {
  // ===== BASIC CRUD =====

  /**
   * Create a persisted Admin user.
   */
  async create({
    username,
    password_hash,
    role,
    is_active: _isActive,
  }: CreateUserData): Promise<DatabaseUserRow> {
    if (role !== UserRole.Admin || !password_hash) {
      throw new Error('Only admin users can be persisted')
    }
    const id = await insertAdminUser({
      username,
      passwordHash: password_hash,
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
      const result = await execute({
        sql: 'SELECT id, username, role, is_active, created_at, updated_at FROM "user" WHERE id = ?',
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
      const result = await execute({
        sql: 'SELECT id, username, role, is_active, created_at, updated_at FROM "user" WHERE username = ?',
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

      if (updates.length === 0) {
        return this.getById(id)
      }

      updates.push('updated_at = CURRENT_TIMESTAMP')
      args.push(id)

      const result = await execute({
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
      const result = await execute({
        sql: `
					SELECT id, username, role, is_active, created_at, updated_at FROM "user"
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
   * Alias required by endpoints that list credit accounts
   */
  async getAllBuilders(): Promise<BuilderWithStats[]> {
    return this.getBuildersWithStats()
  }

  async getBuildersWithStats(): Promise<BuilderWithStats[]> {
    try {
      const result = await execute({
        sql: `
					SELECT
						c.hive_username as id,
						c.hive_username,
						c.created_at,
						COUNT(DISTINCT t.id) as tickets_created,
						c.available_amount as available_credits,
						c.pending_amount as pending_credits,
						CASE WHEN b.hive_username IS NULL THEN 0 ELSE 1 END as is_blocked
					FROM Credits c
					LEFT JOIN Tickets t ON t.owner_builder_username = c.hive_username AND t.funding_source = 'builder_credits'
					LEFT JOIN BlockedHiveAccounts b ON b.hive_username = c.hive_username
					GROUP BY c.hive_username, c.created_at, c.available_amount, c.pending_amount, b.hive_username
					ORDER BY c.created_at DESC
				`,
        args: [],
      })

      return result.rows.map((row: Record<string, unknown>) => ({
        id: String(row.id),
        hive_username: String(row.hive_username),
        created_at: String(row.created_at),
        tickets_created: Number(row.tickets_created || 0),
        available_credits: Number(row.available_credits || 0),
        pending_credits: Number(row.pending_credits || 0),
        is_blocked: Number(row.is_blocked || 0) !== 0,
      }))
    } catch {
      return []
    }
  }

  async countAdmins(): Promise<number> {
    try {
      const result = await execute({
        sql: 'SELECT COUNT(*) as total FROM "user" WHERE role = ?',
        args: [UserRole.Admin],
      })
      return Number(result.rows[0]?.total || 0)
    } catch {
      return 0
    }
  }

  async countAll(): Promise<number> {
    try {
      const result = await execute({
        sql: 'SELECT COUNT(*) as total FROM "user"',
        args: [],
      })
      return Number(result.rows[0]?.total || 0)
    } catch {
      return 0
    }
  }

  async hasAdmin(): Promise<boolean> {
    return (await this.countAdmins()) > 0
  }

  async usernameExists(username: string): Promise<boolean> {
    return (await this.getByUsername(username)) !== null
  }

  async findById(id: string): Promise<DatabaseUserRow | null> {
    return this.getById(id)
  }

  async findByUsername(username: string): Promise<DatabaseUserRow | null> {
    return this.getByUsername(username)
  }

  // ===== BUILDER SPECIFIC METHODS =====

  /**
   * Get accounts created by a specific builder (by ID)
   * Uses subquery to resolve username, avoiding a sequential getById() call.
   * Uses the builder_username field from Accounts to show accounts even if the ticket was deleted.
   */
  async getAccountsByUser(builderId: string): Promise<AccountWithTicketInfo[]> {
    try {
      const result = await execute({
        sql: `SELECT
					a.id,
					a.username,
					a.ticket,
					a.creation_date,
					a.registered_at,
					a.builder_username,
					a.blockchain_status,
					t.description as ticket_description,
					t.total_uses as ticket_total_uses,
					t.remaining_uses as ticket_remaining_uses
				FROM Accounts a
				LEFT JOIN Tickets t ON a.ticket_id = t.id
				WHERE a.builder_username = ?
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
        ticket_total_uses: Number(row.ticket_total_uses || 0),
        ticket_remaining_uses: Number(row.ticket_remaining_uses || 0),
        blockchain_status: String(row.blockchain_status),
        status_label: toAccountStatusLabel(String(row.blockchain_status)),
      }))
    } catch (error) {
      return []
    }
  }

  /**
   * Get statistics of a specific builder (by ID)
   * Single query with subqueries — avoids 4 sequential round-trips.
   * Uses builder_username to count accounts even if tickets were deleted.
   */
  async getBuildersStats(builderId: string): Promise<BuildersStats> {
    try {
      const result = await execute({
        sql: `SELECT
					(SELECT COUNT(*) FROM Accounts
					 WHERE builder_username = ?
					) as total_accounts,
					(SELECT COUNT(*) FROM Tickets
					 WHERE owner_builder_username = ? AND funding_source = 'builder_credits' AND remaining_uses > 0 AND revoked_at IS NULL AND archived_at IS NULL
					) as active_tickets,
					(SELECT COALESCE(SUM(total_uses), 0) FROM Tickets
					 WHERE owner_builder_username = ? AND funding_source = 'builder_credits' AND remaining_uses > 0 AND revoked_at IS NULL AND archived_at IS NULL
					) as total_original,
					(SELECT COALESCE(SUM(remaining_uses), 0) FROM Tickets
					 WHERE owner_builder_username = ? AND funding_source = 'builder_credits' AND remaining_uses > 0 AND revoked_at IS NULL AND archived_at IS NULL
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
  readonly ticket_total_uses: number
  readonly ticket_remaining_uses: number
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
