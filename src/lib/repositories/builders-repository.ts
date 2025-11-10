/**
 * 👷 BUILDERS REPOSITORY
 *
 * Centraliza todas las operaciones de base de datos relacionadas con builders.
 * Gestiona usuarios builders que crean cuentas vía Keychain.
 *
 * Responsabilidades:
 * - Consultas específicas del área de builders
 * - Estadísticas de tickets y cuentas por builder
 * - Evita duplicación de código SQL entre páginas
 */
import { TICKET_TYPES, type TicketType } from '@/consts/constants'
import { db } from '@/lib/database'
import { isTicketType } from '@/types/database'
// Logger removed
import { sqliteToBoolean } from '@/utils/sqlite-helpers'

export interface AccountWithTicketInfo {
  readonly id: number
  readonly username: string
  readonly ticket: string
  readonly creation_date: string
  readonly registered_at: string
  readonly ticket_type: TicketType
  readonly ticket_description: string | null
  readonly ticket_original_credits: number
  readonly ticket_remaining_credits: number
}

export interface TicketInfo {
  readonly code: string
  readonly type: TicketType
  readonly description: string | null
  readonly original_credits: number
  readonly credits: number
  readonly created_by_builder: number | null
  readonly created_by_admin: number | null
  readonly created_at: string
  readonly is_active: boolean
}

export interface BuildersStats {
  totalAccounts: number
  totalActiveTickets: number
  totalCreditsUsed: number
  totalCreditsRemaining: number
}

export class BuildersRepository {
	// ===== CRUD BÁSICO =====

	/**
	 * Obtener todos los builders
	 */
	async getAll(): Promise<Array<{
		id: number
		hive_username: string
		is_active: boolean
		last_claim_at: string | null
		created_at: string
	}>> {
		try {
			const result = await db.execute({
				sql: `
					SELECT id, hive_username, is_active, last_claim_at, created_at
					FROM Builders
					ORDER BY created_at DESC
				`,
				args: [],
			})

			return result.rows.map((row: Record<string, unknown>) => ({
				id: Number(row.id),
				hive_username: String(row.hive_username),
				is_active: sqliteToBoolean(row.is_active),
				last_claim_at: row.last_claim_at as string | null,
				created_at: String(row.created_at),
			}))
		} catch (error) {
			return []
		}
	}

	/**
	 * Obtener builder por ID
	 */
	async getById(id: number): Promise<{
		id: number
		hive_username: string
		is_active: boolean
		last_claim_at: string | null
		created_at: string
	} | null> {
		try {
			const result = await db.execute({
				sql: 'SELECT * FROM Builders WHERE id = ?',
				args: [id],
			})

			if (result.rows.length === 0) {
				return null
			}

			const row = result.rows[0] as Record<string, unknown>

			return {
				id: Number(row.id),
				hive_username: String(row.hive_username),
				is_active: sqliteToBoolean(row.is_active),
				last_claim_at: row.last_claim_at as string | null,
				created_at: String(row.created_at),
			}
		} catch (error) {
			return null
		}
	}

	/**
	 * Verificar si existe un builder por hive_username
	 */
	async existsByUsername(username: string): Promise<boolean> {
		try {
			const result = await db.execute({
				sql: 'SELECT COUNT(*) as count FROM Builders WHERE hive_username = ?',
				args: [username],
			})

			return Number(result.rows[0]?.count || 0) > 0
		} catch (error) {
			return false
		}
	}

	/**
	 * Crear un nuevo builder
	 * Retorna el ID del builder creado
	 */
	async create(hive_username: string): Promise<number> {
		try {
			const cleanUsername = hive_username.trim().toLowerCase()

			const result = await db.execute({
				sql: `INSERT INTO Builders (hive_username, is_active)
					  VALUES (?, TRUE) RETURNING id`,
				args: [cleanUsername],
			})

			const builderId = result.rows[0]?.id

			if (!builderId) {
				throw new Error('Error al crear builder: ID no obtenido')
			}

			return Number(builderId)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Eliminar un builder por ID
	 */
	async delete(id: number): Promise<void> {
		try {
			await db.execute({
				sql: 'DELETE FROM Builders WHERE id = ?',
				args: [id],
			})
		} catch (error) {
			throw error
		}
	}

	// ===== QUERIES ESPECIALIZADAS =====

	/**
	 * Obtiene todas las cuentas creadas por un usuario con información de tickets
	 */
	async getAccountsByUser(
    username: string
  ): Promise<AccountWithTicketInfo[]> {
    if (!username) {
      return []
    }
    try {
      const accountsResult = await db.execute({
        sql: `SELECT
					a.id,
					a.username,
					a.ticket,
					a.creation_date,
					a.registered_at,
					t.type as ticket_type,
					t.description as ticket_description,
					t.original_credits as ticket_original_credits,
					t.credits as ticket_remaining_credits
				FROM Accounts a
				LEFT JOIN Tickets t ON a.ticket = t.code
				LEFT JOIN Builders b ON t.created_by_builder = b.id
				WHERE b.hive_username = ?
				ORDER BY a.creation_date DESC`,
        args: [username],
      })

      return accountsResult.rows.map((row: Record<string, unknown>) => {
        const ticketType = isTicketType(row.ticket_type)
          ? row.ticket_type
          : TICKET_TYPES.REGULAR

        return {
          id: Number(row.id),
          username: String(row.username),
          ticket: String(row.ticket),
          creation_date: String(row.creation_date),
          registered_at: String(row.registered_at),
          ticket_type: ticketType,
          ticket_description: (row.ticket_description as string) || null,
          ticket_original_credits: Number(row.ticket_original_credits || 0),
          ticket_remaining_credits: Number(row.ticket_remaining_credits || 0),
        }
      })
    } catch (error) {
      return []
    }
  }

  /**
   * Obtiene todos los tickets creados por un usuario
   */
	async getTicketsByUser(username: string): Promise<TicketInfo[]> {
    if (!username) {
      return []
    }
    try {
      const ticketsResult = await db.execute({
        sql: `SELECT
					t.code,
					t.type,
					t.description,
					t.original_credits,
					t.credits,
					t.created_by_builder,
					t.created_by_admin,
					t.created_at,
					t.is_active
				FROM Tickets t
				LEFT JOIN Builders b ON t.created_by_builder = b.id
				WHERE b.hive_username = ?
				ORDER BY t.created_at DESC`,
        args: [username],
      })

      return ticketsResult.rows.map((row: Record<string, unknown>) => {
        const ticketType = isTicketType(row.type) ? row.type : TICKET_TYPES.FREE

        return {
          code: String(row.code),
          type: ticketType,
          description: (row.description as string) || null,
          original_credits: Number(row.original_credits || 0),
          credits: Number(row.credits || 0),
          created_by_builder:
            row.created_by_builder === null ||
            row.created_by_builder === undefined
              ? null
              : Number(row.created_by_builder),
          created_by_admin:
            row.created_by_admin === null || row.created_by_admin === undefined
              ? null
              : Number(row.created_by_admin),
          created_at: String(row.created_at),
          is_active: Boolean(row.is_active),
        }
      })
    } catch (error) {
      return []
    }
  }

  /**
   * Obtiene estadísticas generales para un usuario builder
   */
	async getBuildersStats(username: string): Promise<BuildersStats> {
    if (!username) {
      return {
        totalAccounts: 0,
        totalActiveTickets: 0,
        totalCreditsUsed: 0,
        totalCreditsRemaining: 0,
      }
    }
    try {
      // Contar cuentas totales creadas por tickets del usuario
      const accountsCountResult = await db.execute({
        sql: `SELECT COUNT(*) as total
              FROM Accounts a
              JOIN Tickets t ON a.ticket = t.code
              JOIN Builders b ON t.created_by_builder = b.id
              WHERE b.hive_username = ?`,
        args: [username],
      })

      // Contar tickets activos
      const activeTicketsResult = await db.execute({
        sql: `SELECT COUNT(*) as total
              FROM Tickets t
              JOIN Builders b ON t.created_by_builder = b.id
              WHERE b.hive_username = ? AND t.is_active = 1`,
        args: [username],
      })

      // Calcular créditos usados y restantes
      const creditsResult = await db.execute({
        sql: `SELECT
					SUM(t.original_credits) as total_original,
					SUM(t.credits) as total_remaining
				FROM Tickets t
				JOIN Builders b ON t.created_by_builder = b.id
				WHERE b.hive_username = ?`,
        args: [username],
      })

      const totalAccounts = Number(accountsCountResult.rows[0]?.total) || 0
      const totalActiveTickets = Number(activeTicketsResult.rows[0]?.total) || 0
      const totalOriginal = Number(creditsResult.rows[0]?.total_original) || 0
      const totalRemaining = Number(creditsResult.rows[0]?.total_remaining) || 0
      const totalCreditsUsed = totalOriginal - totalRemaining

      return {
        totalAccounts,
        totalActiveTickets,
        totalCreditsUsed,
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

  /**
   * Busca cuentas por nombre de usuario (para filtros)
   */
	async searchAccountsByUsername(
    createdBy: string,
    searchTerm: string
  ): Promise<AccountWithTicketInfo[]> {
    if (!createdBy) {
      return []
    }
    try {
      const accountsResult = await db.execute({
        sql: `SELECT
					a.id,
					a.username,
					a.ticket,
					a.creation_date,
					a.registered_at,
					t.type as ticket_type,
					t.description as ticket_description,
					t.original_credits as ticket_original_credits,
					t.credits as ticket_remaining_credits
				FROM Accounts a
				LEFT JOIN Tickets t ON a.ticket = t.code
				LEFT JOIN Builders b ON t.created_by_builder = b.id
				WHERE b.hive_username = ? AND a.username LIKE ?
				ORDER BY a.creation_date DESC`,
        args: [createdBy, `%${searchTerm}%`],
      })

      return accountsResult.rows.map((row: Record<string, unknown>) => {
        const ticketType = isTicketType(row.ticket_type)
          ? row.ticket_type
          : TICKET_TYPES.REGULAR

        return {
          id: Number(row.id),
          username: String(row.username),
          ticket: String(row.ticket),
          creation_date: String(row.creation_date),
          registered_at: String(row.registered_at),
          ticket_type: ticketType,
          ticket_description: (row.ticket_description as string) || null,
          ticket_original_credits: Number(row.ticket_original_credits || 0),
          ticket_remaining_credits: Number(row.ticket_remaining_credits || 0),
        }
      })
    } catch (error) {
      return []
    }
  }
}

// Singleton instance
export const buildersRepository = new BuildersRepository()
