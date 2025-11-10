/**
 * 📊 DASHBOARD SERVICE
 *
 * Servicio especializado para queries complejas multi-tabla usadas en dashboards.
 * Separa la lógica de agregación compleja de los repositories individuales.
 *
 * Responsabilidades:
 * - Estadísticas generales del sistema (multi-entidad)
 * - Queries con múltiples JOINs y agregaciones
 * - Datos consolidados para vistas administrativas
 * - Reportes y métricas del sistema
 */

import { db } from '@/lib/database'
// Logger removed
import { sqliteToBoolean } from '@/utils/sqlite-helpers'

/**
 * Estadísticas generales del dashboard de administración
 */
export interface DashboardStats {
	readonly totalBuilders: number
	readonly totalTickets: number
	readonly usedTickets: number
	readonly totalAccounts: number
	readonly todayAccounts: number
}

/**
 * Ticket reciente con información del creador (para dashboard)
 */
export interface RecentTicketInfo {
	readonly code: string
	readonly type: string
	readonly original_credits: number
	readonly credits: number
	readonly is_active: boolean
	readonly has_been_used: boolean
	readonly created_at: string
	readonly created_by_username: string | null
	readonly creator_type: 'admin' | 'builder' | null
}

/**
 * Cuenta reciente para dashboard
 */
export interface RecentAccountInfo {
	readonly username: string
	readonly ticket: string
	readonly creation_date: string
}

/**
 * Resumen de actividad del sistema
 */
export interface SystemActivitySummary {
	readonly stats: DashboardStats
	readonly recentTickets: RecentTicketInfo[]
	readonly recentAccounts: RecentAccountInfo[]
}

/**
 * Estadísticas de un builder con toda su información
 */
export interface BuilderFullStats {
	readonly builder_id: number
	readonly hive_username: string
	readonly is_active: boolean
	readonly total_tickets: number
	readonly active_tickets: number
	readonly total_accounts: number
	readonly pending_credits: number
	readonly available_credits: number
	readonly total_assigned: number
	readonly total_consumed: number
}

export class DashboardService {
	// ===== ESTADÍSTICAS GENERALES =====

	/**
	 * Obtener todas las estadísticas para el dashboard principal
	 */
	async getDashboardStats(): Promise<DashboardStats> {
		try {
			// Query única con múltiples subqueries para obtener todas las stats
			const result = await db.execute({
				sql: `
					SELECT
						(SELECT COUNT(*) FROM Builders WHERE is_active = TRUE) as total_builders,
						(SELECT COUNT(*) FROM Tickets) as total_tickets,
						(SELECT COUNT(*) FROM Tickets WHERE has_been_used = TRUE) as used_tickets,
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
	 * Obtener tickets recientes con información de creadores
	 */
	async getRecentTickets(limit: number = 5): Promise<RecentTicketInfo[]> {
		try {
			const result = await db.execute({
				sql: `
					SELECT
						t.code,
						t.type,
						t.original_credits,
						t.credits,
						t.is_active,
						t.has_been_used,
						t.created_at,
						COALESCE(b.hive_username, a.username) as created_by_username,
						CASE
							WHEN t.created_by_builder IS NOT NULL THEN 'builder'
							WHEN t.created_by_admin IS NOT NULL THEN 'admin'
							ELSE NULL
						END as creator_type
					FROM Tickets t
					LEFT JOIN Builders b ON t.created_by_builder = b.id
					LEFT JOIN Admins a ON t.created_by_admin = a.id
					ORDER BY t.created_at DESC
					LIMIT ?
				`,
				args: [limit],
			})

			return result.rows.map((row: Record<string, unknown>) => ({
				code: String(row.code),
				type: String(row.type),
				original_credits: Number(row.original_credits),
				credits: Number(row.credits),
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
	 * Obtener cuentas recientes
	 */
	async getRecentAccounts(limit: number = 5): Promise<RecentAccountInfo[]> {
		try {
			const result = await db.execute({
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
	 * Obtener resumen completo de actividad del sistema
	 * (stats + tickets recientes + cuentas recientes en una sola llamada)
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

	// ===== ESTADÍSTICAS DE BUILDERS =====

	/**
	 * Obtener estadísticas completas de un builder (tickets + cuentas + créditos)
	 */
	async getBuilderFullStats(builderId: number): Promise<BuilderFullStats | null> {
		try {
			const result = await db.execute({
				sql: `
					SELECT
						b.id as builder_id,
						b.hive_username,
						b.is_active,
						COALESCE(COUNT(DISTINCT t.id), 0) as total_tickets,
						COALESCE(SUM(CASE WHEN t.is_active = TRUE THEN 1 ELSE 0 END), 0) as active_tickets,
						COALESCE(COUNT(DISTINCT a.id), 0) as total_accounts,
						COALESCE(c.pending_amount, 0) as pending_credits,
						COALESCE(c.available_amount, 0) as available_credits,
						COALESCE(c.total_assigned, 0) as total_assigned,
						COALESCE(c.total_consumed, 0) as total_consumed
					FROM Builders b
					LEFT JOIN Tickets t ON b.id = t.created_by_builder
					LEFT JOIN Accounts a ON t.code = a.ticket
					LEFT JOIN Credits c ON b.id = c.builder_id
					WHERE b.id = ?
					GROUP BY b.id, b.hive_username, b.is_active, c.pending_amount, c.available_amount, c.total_assigned, c.total_consumed
				`,
				args: [builderId],
			})

			if (result.rows.length === 0) {
				return null
			}

			const row = result.rows[0] as Record<string, unknown>

			return {
				builder_id: Number(row.builder_id),
				hive_username: String(row.hive_username),
				is_active: sqliteToBoolean(row.is_active),
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
	 * Obtener estadísticas de todos los builders
	 */
	async getAllBuildersFullStats(): Promise<BuilderFullStats[]> {
		try {
			const result = await db.execute({
				sql: `
					SELECT
						b.id as builder_id,
						b.hive_username,
						b.is_active,
						COALESCE(COUNT(DISTINCT t.id), 0) as total_tickets,
						COALESCE(SUM(CASE WHEN t.is_active = TRUE THEN 1 ELSE 0 END), 0) as active_tickets,
						COALESCE(COUNT(DISTINCT a.id), 0) as total_accounts,
						COALESCE(c.pending_amount, 0) as pending_credits,
						COALESCE(c.available_amount, 0) as available_credits,
						COALESCE(c.total_assigned, 0) as total_assigned,
						COALESCE(c.total_consumed, 0) as total_consumed
					FROM Builders b
					LEFT JOIN Tickets t ON b.id = t.created_by_builder
					LEFT JOIN Accounts a ON t.code = a.ticket
					LEFT JOIN Credits c ON b.id = c.builder_id
					GROUP BY b.id, b.hive_username, b.is_active, c.pending_amount, c.available_amount, c.total_assigned, c.total_consumed
					ORDER BY b.created_at DESC
				`,
				args: [],
			})

			return result.rows.map((row: Record<string, unknown>) => ({
				builder_id: Number(row.builder_id),
				hive_username: String(row.hive_username),
				is_active: sqliteToBoolean(row.is_active),
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

	// ===== REPORTES AGREGADOS =====

	/**
	 * Obtener distribución de tickets por tipo
	 */
	async getTicketTypeDistribution(): Promise<Record<string, number>> {
		try {
			const result = await db.execute({
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
	 * Obtener tendencia de creación de cuentas (últimos N días)
	 */
	async getAccountCreationTrend(days: number = 7): Promise<Array<{ date: string; count: number }>> {
		try {
			const result = await db.execute({
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
	 * Obtener top builders por cuentas creadas
	 */
	async getTopBuildersByAccounts(limit: number = 10): Promise<Array<{
		hive_username: string
		total_accounts: number
		total_tickets: number
	}>> {
		try {
			const result = await db.execute({
				sql: `
					SELECT
						b.hive_username,
						COUNT(DISTINCT a.id) as total_accounts,
						COUNT(DISTINCT t.id) as total_tickets
					FROM Builders b
					LEFT JOIN Tickets t ON b.id = t.created_by_builder
					LEFT JOIN Accounts a ON t.code = a.ticket
					GROUP BY b.id, b.hive_username
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
	 * Obtener resumen de créditos del sistema
	 */
	async getCreditsSummary(): Promise<{
		total_pending: number
		total_available: number
		total_assigned: number
		total_consumed: number
	}> {
		try {
			const result = await db.execute({
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
