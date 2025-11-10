/**
 * 🎫 TICKETS REPOSITORY
 *
 * Centraliza todas las operaciones de base de datos relacionadas con tickets.
 * Evita queries SQL directas en páginas Astro y APIs.
 *
 * Responsabilidades:
 * - CRUD básico de tickets
 * - Queries especializadas (por código, por builder, por admin)
 * - Queries complejas con JOINs (tickets con información de creadores)
 * - Validaciones de negocio relacionadas con tickets
 */

import { db } from '@/lib/database'
// Logger removed
import {
	parseTicketRow,
	parseTicketWithCreatorRow,
	isTicketType,
	type DatabaseTicketRow,
	type TicketWithCreator,
	type CreateTicketData,
	type UpdateTicketData,
} from '@/types/database'
import { TICKET_TYPES } from '@/consts/constants'

/**
 * Resultado de creación de ticket con información del creador
 */
export interface TicketCreationResult {
	readonly id: number
	readonly code: string
	readonly type: string
	readonly description: string | null
	readonly original_credits: number
	readonly credits: number
}

/**
 * Filtros para búsqueda de tickets
 */
export interface TicketFilters {
	readonly builderId?: number
	readonly adminId?: number
	readonly isActive?: boolean
	readonly hasBeenUsed?: boolean
	readonly type?: string
}

/**
 * Estadísticas de tickets para un creador
 */
export interface TicketStats {
	readonly totalTickets: number
	readonly activeTickets: number
	readonly usedTickets: number
	readonly totalCreditsOriginal: number
	readonly totalCreditsRemaining: number
}

export class TicketsRepository {
	// ===== CRUD BÁSICO =====

	/**
	 * Crear un nuevo ticket
	 */
	async create(data: CreateTicketData): Promise<TicketCreationResult> {
		try {
			// Validar tipo de ticket
			if (!isTicketType(data.type)) {
				throw new Error(
				)
			}

			// Validar créditos
			if (data.original_credits <= 0 || data.credits < 0) {
				throw new Error('Los créditos deben ser mayores a 0')
			}

			if (data.credits > data.original_credits) {
				throw new Error(
					'Los créditos actuales no pueden ser mayores a los originales'
				)
			}

			// Validar que tenga exactamente uno de los dos creadores
			const hasBuilder = data.created_by_builder !== null && data.created_by_builder !== undefined
			const hasAdmin = data.created_by_admin !== null && data.created_by_admin !== undefined

			if (!hasBuilder && !hasAdmin) {
				throw new Error('El ticket debe tener un creador (builder o admin)')
			}

			if (hasBuilder && hasAdmin) {
				throw new Error(
					'El ticket no puede tener tanto builder como admin como creador'
				)
			}

			const result = await db.execute({
				sql: `
					INSERT INTO Tickets (
						code, type, description, original_credits, credits,
						created_by_builder, created_by_admin
					)
					VALUES (?, ?, ?, ?, ?, ?, ?)
					RETURNING id, code, type, description, original_credits, credits
				`,
				args: [
					data.code,
					data.type,
					data.description ?? null,
					data.original_credits,
					data.credits,
					data.created_by_builder ?? null,
					data.created_by_admin ?? null,
				],
			})

			if (result.rows.length === 0) {
				throw new Error('No se pudo crear el ticket')
			}

			const row = result.rows[0] as Record<string, unknown>

			return {
				id: Number(row.id),
				code: String(row.code),
				type: String(row.type),
				description: row.description as string | null,
				original_credits: Number(row.original_credits),
				credits: Number(row.credits),
			}
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener ticket por ID
	 */
	async findById(id: number): Promise<DatabaseTicketRow | null> {
		try {
			const result = await db.execute({
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
	 * Obtener ticket por código (clave única)
	 */
	async findByCode(code: string): Promise<DatabaseTicketRow | null> {
		try {
			const result = await db.execute({
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
	 * Actualizar un ticket
	 */
	async update(id: number, data: UpdateTicketData): Promise<void> {
		try {
			// Construir query dinámica solo con campos presentes
			const updates: string[] = []
			const args: (string | number)[] = []

			if (data.description !== undefined) {
				updates.push('description = ?')
				args.push(data.description ?? null)
			}

			if (data.original_credits !== undefined) {
				updates.push('original_credits = ?')
				args.push(data.original_credits)
			}

			if (data.credits !== undefined) {
				updates.push('credits = ?')
				args.push(data.credits)
			}

			if (updates.length === 0) {
				return
			}

			updates.push('updated_at = CURRENT_TIMESTAMP')
			args.push(id)

			const sql = `UPDATE Tickets SET ${updates.join(', ')} WHERE id = ?`

			await db.execute({ sql, args })
		} catch (error) {
			throw error
		}
	}

	/**
	 * Eliminar un ticket
	 */
	async delete(id: number): Promise<void> {
		try {
			await db.execute({
				sql: 'DELETE FROM Tickets WHERE id = ?',
				args: [id],
			})
		} catch (error) {
			throw error
		}
	}

	// ===== QUERIES ESPECIALIZADAS =====

	/**
	 * Obtener todos los tickets creados por un builder
	 */
	async findByBuilder(builderId: number): Promise<DatabaseTicketRow[]> {
		try {
			const result = await db.execute({
				sql: `
					SELECT * FROM Tickets
					WHERE created_by_builder = ?
					ORDER BY created_at DESC
				`,
				args: [builderId],
			})

			return result.rows
				.map(row => parseTicketRow(row))
				.filter((ticket): ticket is DatabaseTicketRow => ticket !== null)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener todos los tickets creados por un admin
	 */
	async findByAdmin(adminId: number): Promise<DatabaseTicketRow[]> {
		try {
			const result = await db.execute({
				sql: `
					SELECT * FROM Tickets
					WHERE created_by_admin = ?
					ORDER BY created_at DESC
				`,
				args: [adminId],
			})

			return result.rows
				.map(row => parseTicketRow(row))
				.filter((ticket): ticket is DatabaseTicketRow => ticket !== null)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener tickets activos (con créditos disponibles)
	 * @deprecated No usado en codebase actual. Se mantendrá por compatibilidad.
	 * Considerar eliminar en v2.0
	 */
	async findActiveTickets(): Promise<DatabaseTicketRow[]> {
		try {
			const result = await db.execute({
				sql: `
					SELECT * FROM Tickets
					WHERE is_active = TRUE
					ORDER BY created_at DESC
				`,
				args: [],
			})

			return result.rows
				.map(row => parseTicketRow(row))
				.filter((ticket): ticket is DatabaseTicketRow => ticket !== null)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Buscar tickets con filtros múltiples
	 * @deprecated No usado en codebase actual. Se mantendrá por compatibilidad.
	 * Considerar eliminar en v2.0
	 */
	async findWithFilters(filters: TicketFilters): Promise<DatabaseTicketRow[]> {
		try {
			const conditions: string[] = []
			const args: (number | boolean | string)[] = []

			if (filters.builderId !== undefined) {
				conditions.push('created_by_builder = ?')
				args.push(filters.builderId)
			}

			if (filters.adminId !== undefined) {
				conditions.push('created_by_admin = ?')
				args.push(filters.adminId)
			}

			if (filters.isActive !== undefined) {
				conditions.push('is_active = ?')
				args.push(filters.isActive)
			}

			if (filters.hasBeenUsed !== undefined) {
				conditions.push('has_been_used = ?')
				args.push(filters.hasBeenUsed)
			}

			if (filters.type !== undefined) {
				conditions.push('type = ?')
				args.push(filters.type)
			}

			const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

			const sql = `
				SELECT * FROM Tickets
				${whereClause}
				ORDER BY created_at DESC
			`

			const result = await db.execute({ sql, args })

			return result.rows
				.map(row => parseTicketRow(row))
				.filter((ticket): ticket is DatabaseTicketRow => ticket !== null)
		} catch (error) {
			throw error
		}
	}

	// ===== QUERIES COMPLEJAS CON JOINS =====

	/**
	 * Obtener todos los tickets con información de sus creadores
	 * JOIN complejo con Builders y Admins
	 */
	async getAllWithCreators(): Promise<TicketWithCreator[]> {
		try {
			const result = await db.execute({
				sql: `
					SELECT
						t.*,
						COALESCE(b.hive_username, a.username) as created_by_username,
						CASE
							WHEN t.created_by_builder IS NOT NULL THEN 'builder'
							WHEN t.created_by_admin IS NOT NULL THEN 'admin'
							ELSE NULL
						END as creator_type,
						COALESCE(b.hive_username, a.username) as creator_name
					FROM Tickets t
					LEFT JOIN Builders b ON t.created_by_builder = b.id
					LEFT JOIN Admins a ON t.created_by_admin = a.id
					ORDER BY t.created_at DESC
				`,
				args: [],
			})

			return result.rows
				.map(row => parseTicketWithCreatorRow(row))
				.filter((ticket): ticket is TicketWithCreator => ticket !== null)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener tickets de un builder con información del creador
	 */
	async getBuilderTicketsWithCreator(
		builderId: number
	): Promise<TicketWithCreator[]> {
		try {
			const result = await db.execute({
				sql: `
					SELECT
						t.*,
						b.hive_username as created_by_username,
						'builder' as creator_type,
						b.hive_username as creator_name
					FROM Tickets t
					LEFT JOIN Builders b ON t.created_by_builder = b.id
					WHERE t.created_by_builder = ?
					ORDER BY t.created_at DESC
				`,
				args: [builderId],
			})

			return result.rows
				.map(row => parseTicketWithCreatorRow(row))
				.filter((ticket): ticket is TicketWithCreator => ticket !== null)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener tickets recientes con creadores (para dashboards)
	 * Limitado a N resultados más recientes
	 */
	async getRecentWithCreators(limit: number = 5): Promise<TicketWithCreator[]> {
		try {
			const result = await db.execute({
				sql: `
					SELECT
						t.*,
						COALESCE(b.hive_username, a.username) as created_by_username,
						CASE
							WHEN t.created_by_builder IS NOT NULL THEN 'builder'
							WHEN t.created_by_admin IS NOT NULL THEN 'admin'
							ELSE NULL
						END as creator_type,
						COALESCE(b.hive_username, a.username) as creator_name
					FROM Tickets t
					LEFT JOIN Builders b ON t.created_by_builder = b.id
					LEFT JOIN Admins a ON t.created_by_admin = a.id
					ORDER BY t.created_at DESC
					LIMIT ?
				`,
				args: [limit],
			})

			return result.rows
				.map(row => parseTicketWithCreatorRow(row))
				.filter((ticket): ticket is TicketWithCreator => ticket !== null)
		} catch (error) {
			throw error
		}
	}

	// ===== ESTADÍSTICAS Y AGREGACIONES =====

	/**
	 * Obtener estadísticas de tickets para un builder
	 * @deprecated No usado en codebase actual. Se mantendrá por compatibilidad.
	 * Considerar eliminar en v2.0
	 */
	async getBuilderStats(builderId: number): Promise<TicketStats> {
		try {
			const result = await db.execute({
				sql: `
					SELECT
						COUNT(*) as total_tickets,
						SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END) as active_tickets,
						SUM(CASE WHEN has_been_used = TRUE THEN 1 ELSE 0 END) as used_tickets,
						SUM(original_credits) as total_credits_original,
						SUM(credits) as total_credits_remaining
					FROM Tickets
					WHERE created_by_builder = ?
				`,
				args: [builderId],
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
	 * Obtener conteo total de tickets en el sistema
	 * @deprecated No usado en codebase actual. Se mantendrá por compatibilidad.
	 * Considerar eliminar en v2.0
	 */
	async countAll(): Promise<number> {
		try {
			const result = await db.execute({
				sql: 'SELECT COUNT(*) as total FROM Tickets',
				args: [],
			})

			return Number(result.rows[0]?.total || 0)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener conteo de tickets usados
	 * @deprecated No usado en codebase actual. Se mantendrá por compatibilidad.
	 * Considerar eliminar en v2.0
	 */
	async countUsed(): Promise<number> {
		try {
			const result = await db.execute({
				sql: 'SELECT COUNT(*) as total FROM Tickets WHERE has_been_used = TRUE',
				args: [],
			})

			return Number(result.rows[0]?.total || 0)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Descontar créditos de un ticket (usado al crear cuenta)
	 */
	async deductCredit(code: string): Promise<void> {
		try {
			const ticket = await this.findByCode(code)

			if (!ticket) {
				throw new Error(`Ticket no encontrado: ${code}`)
			}

			if (ticket.credits <= 0) {
				throw new Error(`Ticket sin créditos disponibles: ${code}`)
			}

			await db.execute({
				sql: `
					UPDATE Tickets
					SET credits = credits - 1, updated_at = CURRENT_TIMESTAMP
					WHERE code = ?
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
