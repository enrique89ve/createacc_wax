/**
 * 📊 DASHBOARD SERVICE
 *
 * Specialized service for complex multi-table queries used in dashboards.
 * Separates complex aggregation logic from individual repositories.
 *
 * Responsibilities:
 * - General system statistics (multi-entity)
 * - Queries with multiple JOINs and aggregations
 * - Consolidated data for administrative views
 * - System reports and metrics
 */

import { execute } from '@/lib/database'
// Logger removed
import { sqliteToBoolean } from '@/utils/sqlite-helpers'

/**
 * General statistics for the administration dashboard
 */
export interface DashboardStats {
  readonly totalBuilders: number
  readonly totalTickets: number
  readonly usedTickets: number
  readonly totalAccounts: number
  readonly todayAccounts: number
}

/**
 * Recent ticket with creator information (for dashboard)
 */
export interface RecentTicketInfo {
  readonly code: string
  readonly total_uses: number
  readonly remaining_uses: number
  readonly is_active: boolean
  readonly has_been_used: boolean
  readonly created_at: string
  readonly created_by_username: string | null
  readonly creator_type: 'admin' | 'builder' | null
}

/**
 * Recent account for dashboard
 */
export interface RecentAccountInfo {
  readonly username: string
  readonly ticket: string
  readonly creation_date: string
}

/**
 * System activity summary
 */
export interface SystemActivitySummary {
  readonly stats: DashboardStats
  readonly recentTickets: RecentTicketInfo[]
  readonly recentAccounts: RecentAccountInfo[]
}

/**
 * Builder statistics with all their information
 */
export interface BuilderFullStats {
  readonly hive_username: string
  readonly total_tickets: number
  readonly active_tickets: number
  readonly total_accounts: number
  readonly pending_credits: number
  readonly available_credits: number
  readonly total_assigned: number
  readonly total_consumed: number
}

export class DashboardService {
  // ===== GENERAL STATISTICS =====

  /**
   * Get all statistics for the main dashboard
   */
  async getDashboardStats(): Promise<DashboardStats> {
    try {
      // Single query with multiple subqueries to get all stats
      const result = await execute({
        sql: `
					SELECT
						(SELECT COUNT(*) FROM Credits) as total_builders,
						(SELECT COUNT(*) FROM Tickets) as total_tickets,
						(SELECT COUNT(*) FROM Tickets WHERE remaining_uses < total_uses) as used_tickets,
						(SELECT COUNT(*) FROM Accounts) as total_accounts,
						(SELECT COUNT(*) FROM Accounts WHERE DATE(creation_date) = DATE('now')) as today_accounts
				`,
        args: [],
      })

      const row = result.rows[0] as Record<string, unknown>

      return {
        totalBuilders: Number(row.total_builders || 0),
        totalTickets: Number(row.total_tickets || 0),
        usedTickets: Number(row.used_tickets || 0),
        totalAccounts: Number(row.total_accounts || 0),
        todayAccounts: Number(row.today_accounts || 0),
      }
    } catch (error) {
      throw error
    }
  }

  /**
   * Get recent tickets with creator information
   */
  async getRecentTickets(limit: number = 5): Promise<RecentTicketInfo[]> {
    try {
      const result = await execute({
        sql: `
					SELECT
						t.code,
						t.total_uses,
						t.remaining_uses,
						(t.remaining_uses > 0 AND t.revoked_at IS NULL) as is_active,
						(t.remaining_uses < t.total_uses) as has_been_used,
						t.created_at,
						t.creator_username as created_by_username,
						'builder' as creator_type
					FROM Tickets t
					ORDER BY t.created_at DESC
					LIMIT ?
				`,
        args: [limit],
      })

      return result.rows.map((row: Record<string, unknown>) => ({
        code: String(row.code),
        total_uses: Number(row.total_uses),
        remaining_uses: Number(row.remaining_uses),
        is_active: sqliteToBoolean(row.is_active),
        has_been_used: sqliteToBoolean(row.has_been_used),
        created_at: String(row.created_at),
        created_by_username: row.created_by_username as string | null,
        creator_type: (row.creator_type as 'admin' | 'builder' | null) ?? null,
      }))
    } catch (error) {
      throw error
    }
  }

  /**
   * Get recent accounts
   */
  async getRecentAccounts(limit: number = 5): Promise<RecentAccountInfo[]> {
    try {
      const result = await execute({
        sql: `
					SELECT username, ticket, creation_date
					FROM Accounts
					ORDER BY creation_date DESC
					LIMIT ?
				`,
        args: [limit],
      })

      return result.rows.map((row: Record<string, unknown>) => ({
        username: String(row.username),
        ticket: String(row.ticket),
        creation_date: String(row.creation_date),
      }))
    } catch (error) {
      throw error
    }
  }

  /**
   * Get complete system activity summary
   * (stats + recent tickets + recent accounts in a single call)
   */
  async getSystemActivitySummary(
    recentLimit: number = 5
  ): Promise<SystemActivitySummary> {
    try {
      const [stats, recentTickets, recentAccounts] = await Promise.all([
        this.getDashboardStats(),
        this.getRecentTickets(recentLimit),
        this.getRecentAccounts(recentLimit),
      ])

      return {
        stats,
        recentTickets,
        recentAccounts,
      }
    } catch (error) {
      throw error
    }
  }

  // ===== BUILDER STATISTICS =====

  /**
   * Get complete builder statistics (tickets + accounts + remaining_uses)
   */
  async getBuilderFullStats(
    builderId: string
  ): Promise<BuilderFullStats | null> {
    try {
      const result = await execute({
        sql: `
					SELECT
						? as hive_username,
						COALESCE(COUNT(DISTINCT t.id), 0) as total_tickets,
                        COALESCE(SUM(CASE WHEN t.remaining_uses > 0 AND t.revoked_at IS NULL THEN 1 ELSE 0 END), 0) as active_tickets,
						COALESCE(COUNT(DISTINCT a.id), 0) as total_accounts,
						COALESCE(c.pending_amount, 0) as pending_credits,
						COALESCE(c.available_amount, 0) as available_credits,
						COALESCE(c.total_assigned, 0) as total_assigned,
						COALESCE(c.total_consumed, 0) as total_consumed
					FROM (SELECT 1)
					LEFT JOIN Tickets t ON t.creator_username = ?
					LEFT JOIN Accounts a ON a.builder_username = ?
					LEFT JOIN Credits c ON c.hive_username = ?
				`,
        args: [builderId, builderId, builderId, builderId],
      })

      if (result.rows.length === 0) {
        return null
      }

      const row = result.rows[0] as Record<string, unknown>

      return {
        hive_username: String(row.hive_username),
        total_tickets: Number(row.total_tickets || 0),
        active_tickets: Number(row.active_tickets || 0),
        total_accounts: Number(row.total_accounts || 0),
        pending_credits: Number(row.pending_credits || 0),
        available_credits: Number(row.available_credits || 0),
        total_assigned: Number(row.total_assigned || 0),
        total_consumed: Number(row.total_consumed || 0),
      }
    } catch (error) {
      throw error
    }
  }

  /**
   * Get statistics of all builders
   */
  async getAllBuildersFullStats(): Promise<BuilderFullStats[]> {
    try {
      const result = await execute({
        sql: `
					SELECT
						c.hive_username,
						COALESCE(COUNT(DISTINCT t.id), 0) as total_tickets,
                        COALESCE(SUM(CASE WHEN t.remaining_uses > 0 AND t.revoked_at IS NULL THEN 1 ELSE 0 END), 0) as active_tickets,
						COALESCE(COUNT(DISTINCT a.id), 0) as total_accounts,
						c.pending_amount as pending_credits,
						c.available_amount as available_credits,
						c.total_assigned,
						c.total_consumed
					FROM Credits c
					LEFT JOIN Tickets t ON t.creator_username = c.hive_username
					LEFT JOIN Accounts a ON a.builder_username = c.hive_username
					GROUP BY c.hive_username, c.pending_amount, c.available_amount, c.total_assigned, c.total_consumed
					ORDER BY c.created_at DESC
				`,
        args: [],
      })

      return result.rows.map((row: Record<string, unknown>) => ({
        hive_username: String(row.hive_username),
        total_tickets: Number(row.total_tickets || 0),
        active_tickets: Number(row.active_tickets || 0),
        total_accounts: Number(row.total_accounts || 0),
        pending_credits: Number(row.pending_credits || 0),
        available_credits: Number(row.available_credits || 0),
        total_assigned: Number(row.total_assigned || 0),
        total_consumed: Number(row.total_consumed || 0),
      }))
    } catch (error) {
      throw error
    }
  }

  // ===== AGGREGATED REPORTS =====

  /**
   * Get ticket distribution by type
   */
  async getTicketTypeDistribution(): Promise<Record<string, number>> {
    try {
      const result = await execute({
        sql: `
					SELECT type, COUNT(*) as count
					FROM Tickets
					GROUP BY type
				`,
        args: [],
      })

      const distribution: Record<string, number> = {}

      for (const row of result.rows) {
        const r = row as Record<string, unknown>
        distribution[String(r.type)] = Number(r.count)
      }

      return distribution
    } catch (error) {
      throw error
    }
  }

  /**
   * Get account creation trend (last N days)
   */
  async getAccountCreationTrend(
    days: number = 7
  ): Promise<Array<{ date: string; count: number }>> {
    try {
      const result = await execute({
        sql: `
					SELECT
						DATE(creation_date) as date,
						COUNT(*) as count
					FROM Accounts
					WHERE DATE(creation_date) >= DATE('now', '-${days} days')
					GROUP BY DATE(creation_date)
					ORDER BY date DESC
				`,
        args: [],
      })

      return result.rows.map((row: Record<string, unknown>) => ({
        date: String(row.date),
        count: Number(row.count),
      }))
    } catch (error) {
      throw error
    }
  }

  /**
   * Get top builders by created accounts
   */
  async getTopBuildersByAccounts(limit: number = 10): Promise<
    Array<{
      hive_username: string
      total_accounts: number
      total_tickets: number
    }>
  > {
    try {
      const result = await execute({
        sql: `
					SELECT
						a.builder_username as hive_username,
						COUNT(DISTINCT a.id) as total_accounts,
						COUNT(DISTINCT t.id) as total_tickets
					FROM Accounts a
					LEFT JOIN Tickets t ON t.creator_username = a.builder_username
					GROUP BY a.builder_username
					ORDER BY total_accounts DESC
					LIMIT ?
				`,
        args: [limit],
      })

      return result.rows.map((row: Record<string, unknown>) => ({
        hive_username: String(row.hive_username),
        total_accounts: Number(row.total_accounts || 0),
        total_tickets: Number(row.total_tickets || 0),
      }))
    } catch (error) {
      throw error
    }
  }

  /**
   * Get system credits summary
   */
  async getCreditsSummary(): Promise<{
    total_pending: number
    total_available: number
    total_assigned: number
    total_consumed: number
  }> {
    try {
      const result = await execute({
        sql: `
					SELECT
						SUM(pending_amount) as total_pending,
						SUM(available_amount) as total_available,
						SUM(total_assigned) as total_assigned,
						SUM(total_consumed) as total_consumed
					FROM Credits
				`,
        args: [],
      })

      const row = result.rows[0] as Record<string, unknown>

      return {
        total_pending: Number(row.total_pending || 0),
        total_available: Number(row.total_available || 0),
        total_assigned: Number(row.total_assigned || 0),
        total_consumed: Number(row.total_consumed || 0),
      }
    } catch (error) {
      throw error
    }
  }
}

// Singleton instance
export const dashboardService = new DashboardService()
