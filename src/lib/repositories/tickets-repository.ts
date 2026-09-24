/**
 * 🎫 TICKETS REPOSITORY
 *
 * Centralizes all database operations related to tickets.
 * Avoids direct SQL queries in Astro pages and APIs.
 *
 * Responsibilities:
 * - Basic ticket CRUD
 * - Specialized queries (by code, by builder, by admin)
 * - Complex queries with JOINs (tickets with creator information)
 * - Business validations related to tickets
 */

import { execute } from '@/lib/database'
import { MAX_TICKET_USES } from '@/consts/constants'
// Logger removed
import {
  parseTicketRow,
  parseTicketWithCreatorRow,
  compactMap,
  type DatabaseTicketRow,
  type TicketWithCreator,
  type CreateTicketData,
  type UpdateTicketData,
} from '@/types/database'

/**
 * Ticket creation result with creator information
 */
export interface TicketCreationResult {
  readonly id: number
  readonly code: string
  readonly description: string | null
  readonly total_uses: number
  readonly remaining_uses: number
}

/**
 * Filters for ticket search
 */
export interface TicketFilters {
  readonly createdBy?: string
  readonly isActive?: boolean
  readonly hasBeenUsed?: boolean
}

/**
 * Ticket statistics for a creator
 */
export interface TicketStats {
  readonly totalTickets: number
  readonly activeTickets: number
  readonly usedTickets: number
  readonly totalCreditsOriginal: number
  readonly totalCreditsRemaining: number
}

export class TicketsRepository {
  // ===== BASIC CRUD =====

  /**
   * Create a new ticket
   */
  async create(data: CreateTicketData): Promise<TicketCreationResult> {
    try {
      // Validate ticket uses
      if (data.total_uses <= 0 || data.remaining_uses < 0) {
        throw new Error('Ticket uses must be greater than 0')
      }

      if (data.remaining_uses > data.total_uses) {
        throw new Error('Remaining uses cannot be greater than total uses')
      }

      const result = await execute({
        sql: `
					INSERT INTO Tickets (
						code, description, total_uses, remaining_uses, creator_username,
						funding_source, owner_builder_username, issuer_admin_id
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?)
					RETURNING id, code, description, total_uses, remaining_uses
				`,
        args: [
          data.code,
          data.description ?? null,
          data.total_uses,
          data.remaining_uses,
          data.creator_username ?? null,
          data.funding_source,
          data.funding_source === 'builder_credits'
            ? data.owner_builder_username
            : null,
          data.funding_source === 'system' ? data.issuer_admin_id : null,
        ],
      })

      if (result.rows.length === 0) {
        throw new Error('Could not create ticket')
      }

      const row = result.rows[0] as Record<string, unknown>

      return {
        id: Number(row.id),
        code: String(row.code),
        description: row.description as string | null,
        total_uses: Number(row.total_uses),
        remaining_uses: Number(row.remaining_uses),
      }
    } catch (error) {
      throw error
    }
  }

  /**
   * Get ticket by ID
   */
  async findById(id: number): Promise<DatabaseTicketRow | null> {
    try {
      const result = await execute({
        sql: 'SELECT * FROM Tickets WHERE id = ?',
        args: [id],
      })

      if (result.rows.length === 0) {
        return null
      }

      return parseTicketRow(result.rows[0])
    } catch (error) {
      throw error
    }
  }

  /**
   * Get ticket by code (unique key)
   */
  async findByCode(code: string): Promise<DatabaseTicketRow | null> {
    try {
      const result = await execute({
        sql: 'SELECT * FROM Tickets WHERE code = ?',
        args: [code],
      })

      if (result.rows.length === 0) {
        return null
      }

      return parseTicketRow(result.rows[0])
    } catch (error) {
      throw error
    }
  }

  /**
   * Update a ticket
   */
  async updateOwned(
    id: number,
    creatorUsername: string,
    data: UpdateTicketData
  ): Promise<boolean> {
    const updates: string[] = []
    const args: (string | number | null)[] = []

    if (data.description !== undefined) {
      updates.push('description = ?')
      args.push(data.description ?? null)
    }
    if (data.total_uses !== undefined) {
      updates.push('total_uses = ?')
      args.push(data.total_uses)
    }
    if (data.remaining_uses !== undefined) {
      updates.push('remaining_uses = ?')
      args.push(data.remaining_uses)
    }
    if (data.revoked_at !== undefined) {
      updates.push('revoked_at = ?')
      args.push(data.revoked_at)
    }
    if (updates.length === 0) return true

    updates.push('updated_at = CURRENT_TIMESTAMP')
    args.push(id, creatorUsername)
    const result = await execute({
      sql: `UPDATE Tickets SET ${updates.join(', ')} WHERE id = ? AND funding_source = 'builder_credits' AND owner_builder_username = ? AND archived_at IS NULL`,
      args,
    })
    return result.rowsAffected === 1
  }

  /** Apply a relative use delta against the current owned ticket state. */
  async updateOwnedUses(
    id: number,
    creatorUsername: string,
    delta: number
  ): Promise<DatabaseTicketRow | null> {
    const result = await execute({
      sql: `
        UPDATE Tickets
        SET
          total_uses = total_uses + ?,
          remaining_uses = remaining_uses + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND funding_source = 'builder_credits'
          AND owner_builder_username = ?
          AND archived_at IS NULL
          AND remaining_uses + ? >= 0
          AND total_uses + ? >= 1
          AND total_uses + ? <= ?
        RETURNING *
      `,
      args: [
        delta,
        delta,
        id,
        creatorUsername,
        delta,
        delta,
        delta,
        MAX_TICKET_USES,
      ],
    })

    if (result.rows.length === 0) return null
    return parseTicketRow(result.rows[0])
  }

  async deleteOwned(id: number, creatorUsername: string): Promise<boolean> {
    const result = await execute({
      sql: `DELETE FROM Tickets WHERE id = ? AND funding_source = 'builder_credits' AND owner_builder_username = ?`,
      args: [id, creatorUsername],
    })
    return result.rowsAffected === 1
  }

  async update(id: number, data: UpdateTicketData): Promise<void> {
    try {
      // Build dynamic query with only present fields
      const updates: string[] = []
      const args: (string | number | null)[] = []

      if (data.description !== undefined) {
        updates.push('description = ?')
        args.push(data.description ?? null)
      }

      if (data.total_uses !== undefined) {
        updates.push('total_uses = ?')
        args.push(data.total_uses)
      }

      if (data.remaining_uses !== undefined) {
        updates.push('remaining_uses = ?')
        args.push(data.remaining_uses)
      }
      if (data.revoked_at !== undefined) {
        updates.push('revoked_at = ?')
        args.push(data.revoked_at)
      }

      if (updates.length === 0) {
        return
      }

      updates.push('updated_at = CURRENT_TIMESTAMP')
      args.push(id)

      const sql = `UPDATE Tickets SET ${updates.join(', ')} WHERE id = ?`

      await execute({ sql, args })
    } catch (error) {
      throw error
    }
  }

  /**
   * Delete a ticket
   */
  async delete(id: number): Promise<void> {
    try {
      await execute({
        sql: 'DELETE FROM Tickets WHERE id = ?',
        args: [id],
      })
    } catch (error) {
      throw error
    }
  }

  // ===== SPECIALIZED QUERIES =====

  /**
   * Get all tickets created by a user (admin or builder)
   */
  async findByCreator(userId: string): Promise<DatabaseTicketRow[]> {
    try {
      const result = await execute({
        sql: `
					SELECT * FROM Tickets
					WHERE creator_username = ?
					ORDER BY created_at DESC
				`,
        args: [userId],
      })

      return compactMap(result.rows, parseTicketRow)
    } catch (error) {
      throw error
    }
  }

  /**
   * Get active tickets (with available remaining_uses)
   * @deprecated Not used in current codebase. Kept for compatibility.
   * Consider deleting in v2.0
   */
  async findActiveTickets(): Promise<DatabaseTicketRow[]> {
    try {
      const result = await execute({
        sql: `
					SELECT * FROM Tickets
					WHERE remaining_uses > 0 AND revoked_at IS NULL AND archived_at IS NULL
					ORDER BY created_at DESC
				`,
        args: [],
      })

      return compactMap(result.rows, parseTicketRow)
    } catch (error) {
      throw error
    }
  }

  /**
   * Search tickets with multiple filters
   * @deprecated Not used in current codebase. Kept for compatibility.
   * Consider deleting in v2.0
   */
  async findWithFilters(filters: TicketFilters): Promise<DatabaseTicketRow[]> {
    try {
      const conditions: string[] = []
      const args: (string | number | boolean)[] = []

      if (filters.createdBy !== undefined) {
                conditions.push('owner_builder_username = ?')
        args.push(filters.createdBy)
      }

      if (filters.isActive !== undefined) {
        conditions.push('(remaining_uses > 0 AND revoked_at IS NULL AND archived_at IS NULL) = ?')
        args.push(filters.isActive)
      }

      if (filters.hasBeenUsed !== undefined) {
        conditions.push('(remaining_uses < total_uses - retired_uses) = ?')
        args.push(filters.hasBeenUsed)
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const sql = `
				SELECT * FROM Tickets
				${whereClause}
				ORDER BY created_at DESC
			`

      const result = await execute({ sql, args })

      return compactMap(result.rows, parseTicketRow)
    } catch (error) {
      throw error
    }
  }

  // ===== COMPLEX QUERIES WITH JOINS =====

  /**
   * Get all tickets with creator information
   * JOIN with Users table
   */
  async getAllWithCreators(): Promise<TicketWithCreator[]> {
    try {
      const result = await execute({
        sql: `
					SELECT
						t.*,
						t.creator_username,
						CASE WHEN t.funding_source = 'system' THEN 'admin' ELSE 'builder' END as creator_role
					FROM Tickets t
					ORDER BY t.created_at DESC
				`,
        args: [],
      })

      return compactMap(result.rows, parseTicketWithCreatorRow)
    } catch (error) {
      throw error
    }
  }

  /**
   * Get tickets for a user with creator information
   */
  async getUserTicketsWithCreator(
    userId: string
  ): Promise<TicketWithCreator[]> {
    try {
      const result = await execute({
        sql: `
					SELECT
						t.*,
						t.creator_username,
						CASE WHEN t.funding_source = 'system' THEN 'admin' ELSE 'builder' END as creator_role
					FROM Tickets t
					WHERE t.funding_source = 'builder_credits'
					  AND t.owner_builder_username = ?
					ORDER BY t.created_at DESC
				`,
        args: [userId],
      })

      return compactMap(result.rows, parseTicketWithCreatorRow)
    } catch (error) {
      throw error
    }
  }

  /**
   * Get tickets created by a specific builder (helper for builder views)
   */
  async getBuilderTicketsWithCreator(
    builderId: string
  ): Promise<TicketWithCreator[]> {
    return this.getUserTicketsWithCreator(builderId)
  }

  /**
   * Get recent tickets with creators (for dashboards)
   * Limited to N most recent results
   */
  async getRecentWithCreators(limit: number = 5): Promise<TicketWithCreator[]> {
    try {
      const result = await execute({
        sql: `
					SELECT
						t.*,
						t.creator_username,
						CASE WHEN t.funding_source = 'system' THEN 'admin' ELSE 'builder' END as creator_role
					FROM Tickets t
					ORDER BY t.created_at DESC
					LIMIT ?
				`,
        args: [limit],
      })

      return compactMap(result.rows, parseTicketWithCreatorRow)
    } catch (error) {
      throw error
    }
  }

  // ===== STATISTICS AND AGGREGATIONS =====

  /**
   * Get ticket statistics for a user
   * @deprecated Not used in current codebase. Kept for compatibility.
   * Consider deleting in v2.0
   */
  async getUserStats(userId: string): Promise<TicketStats> {
    try {
      const result = await execute({
        sql: `
					SELECT
						COUNT(*) as total_tickets,
						SUM(CASE WHEN remaining_uses > 0 AND revoked_at IS NULL THEN 1 ELSE 0 END) as active_tickets,
						SUM(CASE WHEN remaining_uses < total_uses THEN 1 ELSE 0 END) as used_tickets,
						SUM(total_uses) as total_credits_original,
						SUM(remaining_uses) as total_credits_remaining
					FROM Tickets
					WHERE owner_builder_username = ? AND funding_source = 'builder_credits'
				`,
        args: [userId],
      })

      if (result.rows.length === 0) {
        return {
          totalTickets: 0,
          activeTickets: 0,
          usedTickets: 0,
          totalCreditsOriginal: 0,
          totalCreditsRemaining: 0,
        }
      }

      const row = result.rows[0] as Record<string, unknown>

      return {
        totalTickets: Number(row.total_tickets || 0),
        activeTickets: Number(row.active_tickets || 0),
        usedTickets: Number(row.used_tickets || 0),
        totalCreditsOriginal: Number(row.total_credits_original || 0),
        totalCreditsRemaining: Number(row.total_credits_remaining || 0),
      }
    } catch (error) {
      throw error
    }
  }

  /**
   * Get total count of tickets in the system
   * @deprecated Not used in current codebase. Kept for compatibility.
   * Consider deleting in v2.0
   */
  async countAll(): Promise<number> {
    try {
      const result = await execute({
        sql: 'SELECT COUNT(*) as total FROM Tickets',
        args: [],
      })

      return Number(result.rows[0]?.total || 0)
    } catch (error) {
      throw error
    }
  }

  /**
   * Get count of used tickets
   * @deprecated Not used in current codebase. Kept for compatibility.
   * Consider deleting in v2.0
   */
  async countUsed(): Promise<number> {
    try {
      const result = await execute({
        sql: 'SELECT COUNT(*) as total FROM Tickets WHERE remaining_uses < total_uses',
        args: [],
      })

      return Number(result.rows[0]?.total || 0)
    } catch (error) {
      throw error
    }
  }

  /**
   * Deduct one use from a ticket (used when creating an account)
   */
  async deductCredit(code: string): Promise<void> {
    try {
      const ticket = await this.findByCode(code)

      if (!ticket) {
        throw new Error(`Ticket not found: ${code}`)
      }

      if (ticket.remaining_uses <= 0) {
        throw new Error(`Ticket without available remaining_uses: ${code}`)
      }

      await execute({
        sql: `
					UPDATE Tickets
						SET remaining_uses = remaining_uses - 1, updated_at = CURRENT_TIMESTAMP
						WHERE code = ? AND remaining_uses > 0 AND revoked_at IS NULL AND archived_at IS NULL
				`,
        args: [code],
      })
    } catch (error) {
      throw error
    }
  }
}

// Singleton instance
export const ticketsRepository = new TicketsRepository()
