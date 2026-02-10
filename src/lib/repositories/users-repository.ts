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
   * SEGURIDAD: Columnas explícitas - NO incluir password_hash
   */
  async getById(id: number): Promise<DatabaseUserRow | null> {
    try {
      const result = await db.execute({
        sql: 'SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM Users WHERE id = ?',
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
   * SEGURIDAD: Columnas explícitas - NO incluir password_hash
   */
  async getByUsername(username: string): Promise<DatabaseUserRow | null> {
    try {
      const result = await db.execute({
        sql: 'SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM Users WHERE username = ?',
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
   * SEGURIDAD: Columnas explícitas - NO incluir password_hash
   */
  async getAdmins(): Promise<DatabaseUserRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM Users
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
   * SEGURIDAD: Columnas explícitas - NO incluir password_hash
   */
  async getBuilders(): Promise<DatabaseUserRow[]> {
    try {
      const result = await db.execute({
        sql: `
					SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM Users
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
   * Desactivar/Banear builder (Soft Delete)
   *
   * En lugar de eliminar físicamente, marcamos como inactivo para:
   * - Preservar el ID único (evitar colisiones con nuevos builders)
   * - Mantener todo el historial intacto (CreditAudit, TicketAudit, Accounts)
   * - Poder reactivar si es necesario
   *
   * SE HACE:
   * - Marcar usuario como is_active = false
   * - Desactivar todos los tickets (is_active = false)
   * - Poner créditos a 0 (pending y available)
   *
   * SE PRESERVA:
   * - El registro del usuario (con is_active = false)
   * - Todos los tickets (marcados como inactivos)
   * - Accounts: historial completo de cuentas creadas
   * - CreditAudit: historial completo de créditos
   * - TicketAudit: historial completo de tickets
   */
  async deleteBuilderWithReferences(builderId: number): Promise<void> {
    await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

    try {
      // 1. Desactivar todos los tickets del builder (poner créditos a 0)
      // is_active es columna VIRTUAL (credits > 0), no se puede escribir directamente
      await db.execute({
        sql: 'UPDATE Tickets SET credits = 0, updated_at = CURRENT_TIMESTAMP WHERE created_by = ?',
        args: [builderId],
      })

      // 2. Poner créditos a 0 (pero mantener el registro para referencia)
      await db.execute({
        sql: `UPDATE Credits 
              SET pending_amount = 0, 
                  available_amount = 0,
                  updated_at = CURRENT_TIMESTAMP 
              WHERE builder_id = ?`,
        args: [builderId],
      })

      // 3. Registrar en auditoría que el builder fue desactivado
      await db.execute({
        sql: `INSERT INTO CreditAudit (
                builder_id, operation, amount, reason, timestamp
              ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        args: [
          builderId,
          'builder_deactivated',
          0,
          'Builder desactivado/baneado por admin',
        ],
      })

      // 4. Marcar el usuario como inactivo (Soft Delete)
      await db.execute({
        sql: `UPDATE Users 
              SET is_active = 0, 
                  updated_at = CURRENT_TIMESTAMP 
              WHERE id = ? AND role = 'builder'`,
        args: [builderId],
      })

      await db.execute({ sql: 'COMMIT', args: [] })
    } catch (error) {
      await db.execute({ sql: 'ROLLBACK', args: [] })
      throw error
    }
  }

  /**
   * Reactivar un builder previamente desactivado
   */
  async reactivateBuilder(builderId: number): Promise<void> {
    await db.execute({
      sql: `UPDATE Users 
            SET is_active = 1, 
                updated_at = CURRENT_TIMESTAMP 
            WHERE id = ? AND role = 'builder'`,
      args: [builderId],
    })

    // Registrar en auditoría
    await db.execute({
      sql: `INSERT INTO CreditAudit (
              builder_id, operation, amount, reason, timestamp
            ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      args: [
        builderId,
        'builder_reactivated',
        0,
        'Builder reactivado por admin',
      ],
    })
  }

  // ===== MÉTODOS ESPECÍFICOS PARA BUILDERS =====

  /**
   * Obtener cuentas creadas por un builder específico (por ID)
   * Usa el campo ticket_by de Accounts para mostrar cuentas incluso si el ticket fue eliminado
   */
  async getAccountsByUser(builderId: number): Promise<AccountWithTicketInfo[]> {
    try {
      const builder = await this.getById(builderId)

      if (!builder) {
        return []
      }

      const builderUsername = builder.username

      // Buscar cuentas por ticket_by (preserva historial aunque el ticket no exista)
      const accountsResult = await db.execute({
        sql: `SELECT
					a.id,
					a.username,
					a.ticket,
					a.creation_date,
					a.registered_at,
					a.ticket_by,
					t.description as ticket_description,
					t.original_credits as ticket_original_credits,
					t.credits as ticket_remaining_credits
				FROM Accounts a
				LEFT JOIN Tickets t ON a.ticket = t.code
				WHERE a.ticket_by = ?
				ORDER BY a.creation_date DESC`,
        args: [builderUsername],
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
   * Usa ticket_by para contar cuentas incluso si los tickets fueron eliminados
   */
  async getBuildersStats(builderId: number): Promise<BuildersStats> {
    try {
      const builder = await this.getById(builderId)

      if (!builder) {
        return {
          totalAccounts: 0,
          totalActiveTickets: 0,
          totalCreditsUsed: 0,
          totalCreditsRemaining: 0,
        }
      }

      const builderUsername = builder.username

      // Contar cuentas totales usando ticket_by (preserva historial)
      const accountsCountResult = await db.execute({
        sql: `SELECT COUNT(*) as total FROM Accounts WHERE ticket_by = ?`,
        args: [builderUsername],
      })

      // Contar tickets activos
      const activeTicketsResult = await db.execute({
        sql: `SELECT COUNT(*) as total
					FROM Tickets t
					WHERE t.created_by = ? AND t.is_active = 1`,
        args: [builderId],
      })

      // Calcular créditos restantes en tickets activos
      const creditsResult = await db.execute({
        sql: `SELECT
					SUM(t.original_credits) as total_original,
					SUM(t.credits) as total_remaining
				FROM Tickets t
				WHERE t.created_by = ? AND t.is_active = 1`,
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
