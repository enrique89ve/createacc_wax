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
  type DatabaseTicketRow,
  type TicketWithCreator,
  type CreateTicketData,
  type UpdateTicketData,
} from '@/types/database'

/**
 * Resultado de creación de ticket con información del creador
 */
export interface TicketCreationResult {
  readonly id: number
  readonly code: string
  readonly description: string | null
  readonly original_credits: number
  readonly credits: number
}

/**
 * Filtros para búsqueda de tickets
 */
export interface TicketFilters {
  readonly createdBy?: number
  readonly isActive?: boolean
  readonly hasBeenUsed?: boolean
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
      // Validar créditos
      if (data.original_credits <= 0 || data.credits < 0) {
        throw new Error('Los créditos deben ser mayores a 0')
      }

      if (data.credits > data.original_credits) {
        throw new Error(
          'Los créditos actuales no pueden ser mayores a los originales'
        )
      }

      const result = await db.execute({
        sql: `
					INSERT INTO Tickets (
						code, description, original_credits, credits, created_by
					)
					VALUES (?, ?, ?, ?, ?)
					RETURNING id, code, description, original_credits, credits
				`,
        args: [
          data.code,
          data.description ?? null,
          data.original_credits,
          data.credits,
          data.created_by ?? null,
        ],
      })

      if (result.rows.length === 0) {
        throw new Error('No se pudo crear el ticket')
      }

      const row = result.rows[0] as Record<string, unknown>

      return {
        id: Number(row.id),
        code: String(row.code),
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
      const args: (string | number | null)[] = []

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
   * Obtener todos los tickets creados por un usuario (admin o builder)
   */
  async findByCreator(userId: number): Promise<DatabaseTicketRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT * FROM Tickets
					WHERE created_by = ?
					ORDER BY created_at DESC
				`,
        args: [userId],
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
      const args: (number | boolean)[] = []

      if (filters.createdBy !== undefined) {
        conditions.push('created_by = ?')
        args.push(filters.createdBy)
      }

      if (filters.isActive !== undefined) {
        conditions.push('is_active = ?')
        args.push(filters.isActive)
      }

      if (filters.hasBeenUsed !== undefined) {
        conditions.push('has_been_used = ?')
        args.push(filters.hasBeenUsed)
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

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
   * JOIN con Users table
   */
  async getAllWithCreators(): Promise<TicketWithCreator[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT
						t.*,
						u.username as creator_username,
						u.role as creator_role
					FROM Tickets t
					LEFT JOIN Users u ON t.created_by = u.id
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
   * Obtener tickets de un usuario con información del creador
   */
  async getUserTicketsWithCreator(
    userId: number
  ): Promise<TicketWithCreator[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT
						t.*,
						u.username as creator_username,
						u.role as creator_role
					FROM Tickets t
					LEFT JOIN Users u ON t.created_by = u.id
					WHERE t.created_by = ?
					ORDER BY t.created_at DESC
				`,
        args: [userId],
      })

      return result.rows
        .map(row => parseTicketWithCreatorRow(row))
        .filter((ticket): ticket is TicketWithCreator => ticket !== null)
    } catch (error) {
      throw error
    }
  }

  /**
   * Obtener tickets creados por un builder específico (helper para vistas de builders)
   */
  async getBuilderTicketsWithCreator(
    builderId: number
  ): Promise<TicketWithCreator[]> {
    return this.getUserTicketsWithCreator(builderId)
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
						u.username as creator_username,
						u.role as creator_role
					FROM Tickets t
					LEFT JOIN Users u ON t.created_by = u.id
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
   * Obtener estadísticas de tickets para un usuario
   * @deprecated No usado en codebase actual. Se mantendrá por compatibilidad.
   * Considerar eliminar en v2.0
   */
  async getUserStats(userId: number): Promise<TicketStats> {
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
					WHERE created_by = ?
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
