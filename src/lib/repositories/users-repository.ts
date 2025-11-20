/**
 * 👥 USERS REPOSITORY
 *
 * Centraliza todas las operaciones de base de datos relacionadas con usuarios (admins y builders).
 * Gestiona la tabla unificada Users con roles 'admin' y 'builder'.
 *
 * Responsabilidades:
 * - CRUD de usuarios (admins y builders)
 * - Queries especializadas con estadísticas
 * - Evita duplicación de código SQL entre páginas
 */

import { db } from '@/lib/database'
import {
  parseUserRow,
  type DatabaseUserRow,
  type CreateUserData,
  type UpdateUserData,
} from '@/types/database'
import { sqliteToBoolean } from '@/utils/sqlite-helpers'

/**
 * Builder con estadísticas de tickets y créditos
 */
export interface BuilderWithStats {
  readonly id: number
  readonly hive_username: string
  readonly is_active: boolean
  readonly last_claim_at: string | null
  readonly created_at: string
  readonly tickets_created: number
  readonly available_credits: number
  readonly pending_credits: number
}

export class UsersRepository {
  // ===== CRUD BÁSICO =====

  /**
   * Crear un nuevo usuario (admin o builder)
   */
  async create({
    username,
    password_hash,
    role,
    is_active,
  }: CreateUserData): Promise<DatabaseUserRow> {
    const result = await db.execute({
      sql: `
				INSERT INTO Users (username, password_hash, role, is_active)
				VALUES (?, ?, ?, ?)
				RETURNING *
			`,
      args: [username, password_hash ?? null, role, is_active ?? true],
    })

    if (result.rows.length === 0) {
      throw new Error('Failed to create user')
    }

    const createdUser = parseUserRow(result.rows[0])
    if (!createdUser) {
      throw new Error('Failed to parse created user row')
    }

    return createdUser
  }

  /**
   * Obtener usuario por ID
   */
  async getById(id: number): Promise<DatabaseUserRow | null> {
    try {
      const result = await db.execute({
        sql: 'SELECT * FROM Users WHERE id = ?',
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
   * Obtener usuario por username
   */
  async getByUsername(username: string): Promise<DatabaseUserRow | null> {
    try {
      const result = await db.execute({
        sql: 'SELECT * FROM Users WHERE username = ?',
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
   * Actualizar usuario
   */
  async update(
    id: number,
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
					UPDATE Users
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

  // ===== QUERIES ESPECIALIZADAS =====

  /**
   * Obtener todos los usuarios con rol 'admin'
   */
  async getAdmins(): Promise<DatabaseUserRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT * FROM Users
					WHERE role = 'admin'
					ORDER BY created_at DESC
				`,
        args: [],
      })

      return result.rows
        .map(row => parseUserRow(row))
        .filter((user): user is DatabaseUserRow => user !== null)
    } catch (error) {
      return []
    }
  }

  /**
   * Obtener todos los usuarios con rol 'builder'
   */
  async getBuilders(): Promise<DatabaseUserRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT * FROM Users
					WHERE role = 'builder'
					ORDER BY created_at DESC
				`,
        args: [],
      })

      return result.rows
        .map(row => parseUserRow(row))
        .filter((user): user is DatabaseUserRow => user !== null)
    } catch (error) {
      return []
    }
  }

  /**
   * Alias requerido por endpoints legacy que esperan incluir estadísticas básicas
   */
  async getAllBuilders(): Promise<BuilderWithStats[]> {
    return this.getBuildersWithStats()
  }

  /**
   * Obtener builders con estadísticas de tickets y créditos
   * Usado en management console
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
					FROM Users u
					LEFT JOIN Tickets t ON t.created_by = u.id
					LEFT JOIN Credits c ON c.builder_id = u.id
					WHERE u.role = 'builder'
					GROUP BY u.id, u.username, u.is_active, u.last_claim_at, u.created_at
					ORDER BY u.created_at DESC
				`,
        args: [],
      })

      return result.rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
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
   * Obtener conteo de usuarios por rol
   */
  async countByRole(role: 'admin' | 'builder'): Promise<number> {
    try {
      const result = await db.execute({
        sql: 'SELECT COUNT(*) as total FROM Users WHERE role = ?',
        args: [role],
      })

      return Number(result.rows[0]?.total || 0)
    } catch (error) {
      return 0
    }
  }

  /**
   * Obtener conteo total de usuarios
   */
  async countAll(): Promise<number> {
    try {
      const result = await db.execute({
        sql: 'SELECT COUNT(*) as total FROM Users',
        args: [],
      })

      return Number(result.rows[0]?.total || 0)
    } catch (error) {
      return 0
    }
  }

  /**
   * Verificar si existe un admin en el sistema
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
   * Verificar si un username ya existe
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
   * Verificar existencia de builder por username normalizado
   */
  async builderExistsByUsername(username: string): Promise<boolean> {
    try {
      const normalizedUsername = username.trim().toLowerCase()
      const result = await db.execute({
        sql: `
					SELECT 1
					FROM Users
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
   * Alias para compatibilidad con código existente
   */
  async findById(id: number): Promise<DatabaseUserRow | null> {
    return this.getById(id)
  }

  /**
   * Alias para compatibilidad con código existente
   */
  async findByUsername(username: string): Promise<DatabaseUserRow | null> {
    return this.getByUsername(username)
  }

  /**
   * Eliminar builder y todas sus referencias (tickets, cuentas, créditos, auditorías)
   */
  async deleteBuilderWithReferences(builderId: number): Promise<void> {
    await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

    try {
      const ticketsResult = await db.execute({
        sql: 'SELECT code FROM Tickets WHERE created_by = ?',
        args: [builderId],
      })

      // Limpiar dependencias basadas en tickets antes de eliminar el builder
      const ticketCodes = ticketsResult.rows
        .map(row => {
          const record = row as Record<string, unknown>
          return typeof record.code === 'string' ? record.code : null
        })
        .filter((code): code is string => code !== null)
        .map(code => code.trim())
        .filter(code => code.length > 0)

      if (ticketCodes.length > 0) {
        const placeholders = ticketCodes.map(() => '?').join(', ')

        await db.execute({
          sql: `DELETE FROM Accounts WHERE ticket IN (${placeholders})`,
          args: ticketCodes,
        })

        await db.execute({
          sql: `DELETE FROM TicketAudit WHERE ticket IN (${placeholders})`,
          args: ticketCodes,
        })
      }

      await db.execute({
        sql: 'UPDATE TicketAudit SET performed_by = NULL WHERE performed_by = ?',
        args: [builderId],
      })

      await db.execute({
        sql: 'UPDATE CreditAudit SET performed_by = NULL WHERE performed_by = ?',
        args: [builderId],
      })

      await db.execute({
        sql: 'DELETE FROM CreditAudit WHERE builder_id = ?',
        args: [builderId],
      })

      await db.execute({
        sql: 'DELETE FROM Credits WHERE builder_id = ?',
        args: [builderId],
      })

      await db.execute({
        sql: 'DELETE FROM Tickets WHERE created_by = ?',
        args: [builderId],
      })

      await db.execute({
        sql: `DELETE FROM Users WHERE id = ? AND role = 'builder'`,
        args: [builderId],
      })

      await db.execute({ sql: 'COMMIT', args: [] })
    } catch (error) {
      await db.execute({ sql: 'ROLLBACK', args: [] })
      throw error
    }
  }

  // ===== MÉTODOS ESPECÍFICOS PARA BUILDERS =====

  /**
   * Obtener cuentas creadas por un builder específico (por ID)
   */
  async getAccountsByUser(builderId: number): Promise<AccountWithTicketInfo[]> {
    try {
      const accountsResult = await db.execute({
        sql: `SELECT
					a.id,
					a.username,
					a.ticket,
					a.creation_date,
					a.registered_at,
					t.description as ticket_description,
					t.original_credits as ticket_original_credits,
					t.credits as ticket_remaining_credits
				FROM Accounts a
				LEFT JOIN Tickets t ON a.ticket = t.code
				WHERE t.created_by = ?
				ORDER BY a.creation_date DESC`,
        args: [builderId],
      })

      return accountsResult.rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        username: String(row.username),
        ticket: String(row.ticket),
        creation_date: String(row.creation_date),
        registered_at: String(row.registered_at),
        ticket_description: (row.ticket_description as string) || null,
        ticket_original_credits: Number(row.ticket_original_credits || 0),
        ticket_remaining_credits: Number(row.ticket_remaining_credits || 0),
      }))
    } catch (error) {
      return []
    }
  }

  /**
   * Obtener estadísticas de un builder específico (por ID)
   */
  async getBuildersStats(builderId: number): Promise<BuildersStats> {
    try {
      // Contar cuentas totales creadas por tickets del usuario
      const accountsCountResult = await db.execute({
        sql: `SELECT COUNT(*) as total
					FROM Accounts a
					JOIN Tickets t ON a.ticket = t.code
					WHERE t.created_by = ?`,
        args: [builderId],
      })

      // Contar tickets activos
      const activeTicketsResult = await db.execute({
        sql: `SELECT COUNT(*) as total
					FROM Tickets t
					WHERE t.created_by = ? AND t.is_active = 1`,
        args: [builderId],
      })

      // Calcular créditos usados y restantes
      const creditsResult = await db.execute({
        sql: `SELECT
					SUM(t.original_credits) as total_original,
					SUM(t.credits) as total_remaining
				FROM Tickets t
				WHERE t.created_by = ?`,
        args: [builderId],
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
}

// ===== TIPOS NECESARIOS =====

/**
 * Cuenta con información del ticket
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
}

/**
 * Estadísticas de un builder
 */
export interface BuildersStats {
  readonly totalAccounts: number
  readonly totalActiveTickets: number
  readonly totalCreditsUsed: number
  readonly totalCreditsRemaining: number
}

// Singleton instance
export const usersRepository = new UsersRepository()
