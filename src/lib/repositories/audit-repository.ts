/**
 * 📊 AUDIT REPOSITORY
 *
 * Centralizes all audit operations for tickets and credits.
 * Provides a comprehensive log system for tracking administrative actions.
 *
 * Responsibilities:
 * - Query TicketAudit logs (create, update, delete of tickets)
 * - Query CreditAudit logs (credit operations)
 * - Filtering by user, action, date
 * - Activity statistics
 */

import { db } from '@/lib/database'
import type {
  DatabaseTicketAuditRow,
  DatabaseCreditAuditRow,
} from '@/types/database'

/**
 * Ticket audit log with information about the user who performed the action
 */
export interface TicketAuditLog extends DatabaseTicketAuditRow {
  readonly performed_by_username: string | null
  readonly performed_by_role: string | null
}

/**
 * Credit audit log with complete information
 */
export interface CreditAuditLog extends DatabaseCreditAuditRow {
  readonly builder_username: string
  readonly performed_by_username: string | null
  readonly performed_by_role: string | null
}

/**
 * Filters for ticket logs search
 */
export interface TicketAuditFilters {
  readonly ticket?: string
  readonly action?: 'create' | 'update' | 'delete'
  readonly performedBy?: string
  readonly dateFrom?: string
  readonly dateTo?: string
}

/**
 * Filters for credit logs search
 */
export interface CreditAuditFilters {
  readonly builderId?: string
  readonly operation?: string
  readonly performedBy?: string
  readonly dateFrom?: string
  readonly dateTo?: string
}

export class AuditRepository {
  // ===== TICKET AUDIT LOGS =====

  /**
   * Get all ticket logs with user information
   */
  async getAllTicketLogs(limit?: number): Promise<TicketAuditLog[]> {
    try {
      const args: number[] = []
      const limitClause = limit ? 'LIMIT ?' : ''
      if (limit) args.push(limit)

      const sql = `
				SELECT
					ta.*,
					u.username as performed_by_username,
					u.role as performed_by_role
				FROM TicketAudit ta
				LEFT JOIN "user" u ON ta.performed_by = u.id
				ORDER BY ta.timestamp DESC
				${limitClause}
			`

      const result = await db.execute({ sql, args })

      return result.rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        ticket: String(row.ticket),
        action: row.action as 'create' | 'update' | 'delete',
        performed_by: row.performed_by ? String(row.performed_by) : null,
        timestamp: String(row.timestamp),
        performed_by_username: row.performed_by_username
          ? String(row.performed_by_username)
          : null,
        performed_by_role: row.performed_by_role
          ? String(row.performed_by_role)
          : null,
      }))
    } catch (error) {
      throw error
    }
  }

  /**
   * Get ticket logs with filters
   */
  async getTicketLogsWithFilters(
    filters: TicketAuditFilters,
    limit?: number
  ): Promise<TicketAuditLog[]> {
    try {
      const conditions: string[] = []
      const args: (string | number)[] = []

      if (filters.ticket) {
        conditions.push('ta.ticket = ?')
        args.push(filters.ticket)
      }

      if (filters.action) {
        conditions.push('ta.action = ?')
        args.push(filters.action)
      }

      if (filters.performedBy) {
        conditions.push('ta.performed_by = ?')
        args.push(filters.performedBy)
      }

      if (filters.dateFrom) {
        conditions.push('DATE(ta.timestamp) >= DATE(?)')
        args.push(filters.dateFrom)
      }

      if (filters.dateTo) {
        conditions.push('DATE(ta.timestamp) <= DATE(?)')
        args.push(filters.dateTo)
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const limitClause = limit ? 'LIMIT ?' : ''
      if (limit) args.push(limit)

      const sql = `
				SELECT
					ta.*,
					u.username as performed_by_username,
					u.role as performed_by_role
				FROM TicketAudit ta
				LEFT JOIN "user" u ON ta.performed_by = u.id
				${whereClause}
				ORDER BY ta.timestamp DESC
				${limitClause}
			`

      const result = await db.execute({ sql, args })

      return result.rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        ticket: String(row.ticket),
        action: row.action as 'create' | 'update' | 'delete',
        performed_by: row.performed_by ? String(row.performed_by) : null,
        timestamp: String(row.timestamp),
        performed_by_username: row.performed_by_username
          ? String(row.performed_by_username)
          : null,
        performed_by_role: row.performed_by_role
          ? String(row.performed_by_role)
          : null,
      }))
    } catch (error) {
      throw error
    }
  }

  /**
   * Get logs for a specific ticket
   */
  async getLogsByTicket(ticketCode: string): Promise<TicketAuditLog[]> {
    return this.getTicketLogsWithFilters({ ticket: ticketCode })
  }

  /**
   * Get logs for a specific user
   */
  async getLogsByUser(userId: string): Promise<TicketAuditLog[]> {
    return this.getTicketLogsWithFilters({ performedBy: userId })
  }

  // ===== CREDIT AUDIT LOGS =====

  /**
   * Get all credit logs with complete information
   */
  async getAllCreditLogs(limit?: number): Promise<CreditAuditLog[]> {
    try {
      const args: number[] = []
      const limitClause = limit ? 'LIMIT ?' : ''
      if (limit) args.push(limit)

      const sql = `
				SELECT
					ca.*,
					b.username as builder_username,
					u.username as performed_by_username,
					u.role as performed_by_role
				FROM CreditAudit ca
				LEFT JOIN "user" b ON ca.hive_username = b.id
				LEFT JOIN "user" u ON ca.performed_by = u.id
				ORDER BY ca.timestamp DESC
				${limitClause}
			`

      const result = await db.execute({ sql, args })

      return result.rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        hive_username: String(row.hive_username),
        operation: String(row.operation),
        amount: Number(row.amount),
        reason: row.reason ? String(row.reason) : null,
        performed_by: row.performed_by ? String(row.performed_by) : null,
        timestamp: String(row.timestamp),
        builder_username: String(row.builder_username),
        performed_by_username: row.performed_by_username
          ? String(row.performed_by_username)
          : null,
        performed_by_role: row.performed_by_role
          ? String(row.performed_by_role)
          : null,
      }))
    } catch (error) {
      throw error
    }
  }

  /**
   * Get credit logs with filters
   */
  async getCreditLogsWithFilters(
    filters: CreditAuditFilters,
    limit?: number
  ): Promise<CreditAuditLog[]> {
    try {
      const conditions: string[] = []
      const args: (string | number)[] = []

      if (filters.builderId) {
        conditions.push('ca.hive_username = ?')
        args.push(filters.builderId)
      }

      if (filters.operation) {
        conditions.push('ca.operation = ?')
        args.push(filters.operation)
      }

      if (filters.performedBy) {
        conditions.push('ca.performed_by = ?')
        args.push(filters.performedBy)
      }

      if (filters.dateFrom) {
        conditions.push('DATE(ca.timestamp) >= DATE(?)')
        args.push(filters.dateFrom)
      }

      if (filters.dateTo) {
        conditions.push('DATE(ca.timestamp) <= DATE(?)')
        args.push(filters.dateTo)
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

      const limitClause = limit ? 'LIMIT ?' : ''
      if (limit) args.push(limit)

      const sql = `
				SELECT
					ca.*,
					b.username as builder_username,
					u.username as performed_by_username,
					u.role as performed_by_role
				FROM CreditAudit ca
				LEFT JOIN "user" b ON ca.hive_username = b.id
				LEFT JOIN "user" u ON ca.performed_by = u.id
				${whereClause}
				ORDER BY ca.timestamp DESC
				${limitClause}
			`

      const result = await db.execute({ sql, args })

      return result.rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        hive_username: String(row.hive_username),
        operation: String(row.operation),
        amount: Number(row.amount),
        reason: row.reason ? String(row.reason) : null,
        performed_by: row.performed_by ? String(row.performed_by) : null,
        timestamp: String(row.timestamp),
        builder_username: String(row.builder_username),
        performed_by_username: row.performed_by_username
          ? String(row.performed_by_username)
          : null,
        performed_by_role: row.performed_by_role
          ? String(row.performed_by_role)
          : null,
      }))
    } catch (error) {
      throw error
    }
  }

  /**
   * Get credit logs for a specific builder
   */
  async getCreditLogsByBuilder(builderId: string): Promise<CreditAuditLog[]> {
    return this.getCreditLogsWithFilters({ builderId })
  }

  // ===== STATISTICS =====

  /**
   * Get count of actions by type (tickets)
   */
  async getTicketActionStats(): Promise<
    Record<'create' | 'update' | 'delete', number>
  > {
    try {
      const result = await db.execute({
        sql: `
					SELECT
						action,
						COUNT(*) as count
					FROM TicketAudit
					GROUP BY action
				`,
        args: [],
      })

      const stats = {
        create: 0,
        update: 0,
        delete: 0,
      }

      for (const row of result.rows) {
        const action = row.action as 'create' | 'update' | 'delete'
        stats[action] = Number(row.count)
      }

      return stats
    } catch (error) {
      throw error
    }
  }

  /**
   * Get total logs count
   */
  async getTotalLogsCount(): Promise<{
    ticketLogs: number
    creditLogs: number
  }> {
    try {
      const ticketResult = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM TicketAudit',
        args: [],
      })

      const creditResult = await db.execute({
        sql: 'SELECT COUNT(*) as count FROM CreditAudit',
        args: [],
      })

      return {
        ticketLogs: Number(ticketResult.rows[0]?.count || 0),
        creditLogs: Number(creditResult.rows[0]?.count || 0),
      }
    } catch (error) {
      throw error
    }
  }
}

// Singleton instance
export const auditRepository = new AuditRepository()
