/**
 * 📊 AUDIT REPOSITORY
 *
 * Centraliza todas las operaciones de auditoría para tickets y créditos.
 * Proporciona un sistema completo de logs para tracking de acciones administrativas.
 *
 * Responsabilidades:
 * - Consulta de logs de TicketAudit (create, update, delete de tickets)
 * - Consulta de logs de CreditAudit (operaciones de créditos)
 * - Filtrado por usuario, acción, fecha
 * - Estadísticas de actividad
 */

import { db } from '@/lib/database'
import type {
	DatabaseTicketAuditRow,
	DatabaseCreditAuditRow,
} from '@/types/database'

/**
 * Log de auditoría de ticket con información del usuario que realizó la acción
 */
export interface TicketAuditLog extends DatabaseTicketAuditRow {
	readonly performed_by_username: string | null
	readonly performed_by_role: string | null
}

/**
 * Log de auditoría de créditos con información completa
 */
export interface CreditAuditLog extends DatabaseCreditAuditRow {
	readonly builder_username: string
	readonly performed_by_username: string | null
	readonly performed_by_role: string | null
}

/**
 * Filtros para búsqueda de logs de tickets
 */
export interface TicketAuditFilters {
	readonly ticket?: string
	readonly action?: 'create' | 'update' | 'delete'
	readonly performedBy?: number
	readonly dateFrom?: string
	readonly dateTo?: string
}

/**
 * Filtros para búsqueda de logs de créditos
 */
export interface CreditAuditFilters {
	readonly builderId?: number
	readonly operation?: string
	readonly performedBy?: number
	readonly dateFrom?: string
	readonly dateTo?: string
}

export class AuditRepository {
	// ===== TICKET AUDIT LOGS =====

	/**
	 * Obtener todos los logs de tickets con información de usuarios
	 */
	async getAllTicketLogs(limit?: number): Promise<TicketAuditLog[]> {
		try {
			const sql = `
				SELECT
					ta.*,
					u.username as performed_by_username,
					u.role as performed_by_role
				FROM TicketAudit ta
				LEFT JOIN Users u ON ta.performed_by = u.id
				ORDER BY ta.timestamp DESC
				${limit ? `LIMIT ${limit}` : ''}
			`

			const result = await db.execute({ sql, args: [] })

			return result.rows.map((row: Record<string, unknown>) => ({
				id: Number(row.id),
				ticket: String(row.ticket),
				action: row.action as 'create' | 'update' | 'delete',
				performed_by: row.performed_by ? Number(row.performed_by) : null,
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
	 * Obtener logs de tickets con filtros
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

			const sql = `
				SELECT
					ta.*,
					u.username as performed_by_username,
					u.role as performed_by_role
				FROM TicketAudit ta
				LEFT JOIN Users u ON ta.performed_by = u.id
				${whereClause}
				ORDER BY ta.timestamp DESC
				${limit ? `LIMIT ${limit}` : ''}
			`

			const result = await db.execute({ sql, args })

			return result.rows.map((row: Record<string, unknown>) => ({
				id: Number(row.id),
				ticket: String(row.ticket),
				action: row.action as 'create' | 'update' | 'delete',
				performed_by: row.performed_by ? Number(row.performed_by) : null,
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
	 * Obtener logs de un ticket específico
	 */
	async getLogsByTicket(ticketCode: string): Promise<TicketAuditLog[]> {
		return this.getTicketLogsWithFilters({ ticket: ticketCode })
	}

	/**
	 * Obtener logs de un usuario específico
	 */
	async getLogsByUser(userId: number): Promise<TicketAuditLog[]> {
		return this.getTicketLogsWithFilters({ performedBy: userId })
	}

	// ===== CREDIT AUDIT LOGS =====

	/**
	 * Obtener todos los logs de créditos con información completa
	 */
	async getAllCreditLogs(limit?: number): Promise<CreditAuditLog[]> {
		try {
			const sql = `
				SELECT
					ca.*,
					b.username as builder_username,
					u.username as performed_by_username,
					u.role as performed_by_role
				FROM CreditAudit ca
				LEFT JOIN Users b ON ca.builder_id = b.id
				LEFT JOIN Users u ON ca.performed_by = u.id
				ORDER BY ca.timestamp DESC
				${limit ? `LIMIT ${limit}` : ''}
			`

			const result = await db.execute({ sql, args: [] })

			return result.rows.map((row: Record<string, unknown>) => ({
				id: Number(row.id),
				builder_id: Number(row.builder_id),
				operation: String(row.operation),
				amount: Number(row.amount),
				reason: row.reason ? String(row.reason) : null,
				performed_by: row.performed_by ? Number(row.performed_by) : null,
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
	 * Obtener logs de créditos con filtros
	 */
	async getCreditLogsWithFilters(
		filters: CreditAuditFilters,
		limit?: number
	): Promise<CreditAuditLog[]> {
		try {
			const conditions: string[] = []
			const args: (string | number)[] = []

			if (filters.builderId) {
				conditions.push('ca.builder_id = ?')
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

			const sql = `
				SELECT
					ca.*,
					b.username as builder_username,
					u.username as performed_by_username,
					u.role as performed_by_role
				FROM CreditAudit ca
				LEFT JOIN Users b ON ca.builder_id = b.id
				LEFT JOIN Users u ON ca.performed_by = u.id
				${whereClause}
				ORDER BY ca.timestamp DESC
				${limit ? `LIMIT ${limit}` : ''}
			`

			const result = await db.execute({ sql, args })

			return result.rows.map((row: Record<string, unknown>) => ({
				id: Number(row.id),
				builder_id: Number(row.builder_id),
				operation: String(row.operation),
				amount: Number(row.amount),
				reason: row.reason ? String(row.reason) : null,
				performed_by: row.performed_by ? Number(row.performed_by) : null,
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
	 * Obtener logs de créditos de un builder específico
	 */
	async getCreditLogsByBuilder(builderId: number): Promise<CreditAuditLog[]> {
		return this.getCreditLogsWithFilters({ builderId })
	}

	// ===== ESTADÍSTICAS =====

	/**
	 * Obtener conteo de acciones por tipo (tickets)
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
	 * Obtener conteo total de logs
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
