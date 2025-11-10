/**
 * 👤 ADMINS REPOSITORY
 *
 * Centraliza todas las operaciones de base de datos relacionadas con administradores.
 * Gestiona el único admin del sistema.
 *
 * Responsabilidades:
 * - CRUD básico de admins (con límite de 1 admin)
 * - Autenticación y gestión de contraseñas
 * - Validaciones de seguridad
 * - Gestión de sesiones de admin
 */

import { db } from '@/lib/database'
// Logger removed
import {
	parseAdminRow,
	type DatabaseAdminRow,
	type CreateAdminData,
	type UpdateAdminData,
} from '@/types/database'

export class AdminsRepository {
	// ===== CRUD BÁSICO =====

	/**
	 * Crear un nuevo admin
	 * IMPORTANTE: Solo puede existir 1 admin en el sistema (constraint en DB)
	 */
	async create(data: CreateAdminData): Promise<DatabaseAdminRow> {
		try {
			// Verificar que no exista ya un admin
			const existingAdmin = await this.findFirst()

			if (existingAdmin) {
				throw new Error(
					'Ya existe un administrador en el sistema. Solo se permite 1 admin.'
				)
			}

			const result = await db.execute({
				sql: `
					INSERT INTO Admins (username, password_hash, is_active)
					VALUES (?, ?, ?)
					RETURNING *
				`,
				args: [
					data.username,
					data.password_hash,
					data.is_active !== undefined ? data.is_active : true,
				],
			})

			if (result.rows.length === 0) {
				throw new Error('No se pudo crear el admin')
			}

			const admin = parseAdminRow(result.rows[0])

			if (!admin) {
				throw new Error('Error al parsear admin creado')
			}

			return admin
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener admin por ID
	 */
	async findById(id: number): Promise<DatabaseAdminRow | null> {
		try {
			const result = await db.execute({
				sql: 'SELECT * FROM Admins WHERE id = ?',
				args: [id],
			})

			if (result.rows.length === 0) {
				return null
			}

			return parseAdminRow(result.rows[0])
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener admin por username
	 */
	async findByUsername(username: string): Promise<DatabaseAdminRow | null> {
		try {
			const result = await db.execute({
				sql: 'SELECT * FROM Admins WHERE username = ?',
				args: [username],
			})

			if (result.rows.length === 0) {
				return null
			}

			return parseAdminRow(result.rows[0])
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener el primer (y único) admin del sistema
	 */
	async findFirst(): Promise<DatabaseAdminRow | null> {
		try {
			const result = await db.execute({
				sql: 'SELECT * FROM Admins LIMIT 1',
				args: [],
			})

			if (result.rows.length === 0) {
				return null
			}

			return parseAdminRow(result.rows[0])
		} catch (error) {
			throw error
		}
	}

	/**
	 * Actualizar admin
	 */
	async update(id: number, data: UpdateAdminData): Promise<void> {
		try {
			const updates: string[] = []
			const args: (string | boolean | number)[] = []

			if (data.password_hash !== undefined) {
				updates.push('password_hash = ?')
				args.push(data.password_hash)
			}

			if (data.is_active !== undefined) {
				updates.push('is_active = ?')
				args.push(data.is_active)
			}

			if (updates.length === 0) {
				return
			}

			updates.push('updated_at = CURRENT_TIMESTAMP')
			args.push(id)

			const sql = `UPDATE Admins SET ${updates.join(', ')} WHERE id = ?`

			await db.execute({ sql, args })
		} catch (error) {
			throw error
		}
	}

	/**
	 * Eliminar admin
	 * ADVERTENCIA: Esto dejará el sistema sin administrador
	 */
	async delete(id: number): Promise<void> {
		try {
			await db.execute({
				sql: 'DELETE FROM Admins WHERE id = ?',
				args: [id],
			})
		} catch (error) {
			throw error
		}
	}

	// ===== QUERIES ESPECIALIZADAS =====

	/**
	 * Verificar si existe un admin en el sistema
	 */
	async exists(): Promise<boolean> {
		try {
			const result = await db.execute({
				sql: 'SELECT COUNT(*) as count FROM Admins',
				args: [],
			})

			return Number(result.rows[0]?.count || 0) > 0
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener admin activo
	 */
	async findActive(): Promise<DatabaseAdminRow | null> {
		try {
			const result = await db.execute({
				sql: 'SELECT * FROM Admins WHERE is_active = TRUE LIMIT 1',
				args: [],
			})

			if (result.rows.length === 0) {
				return null
			}

			return parseAdminRow(result.rows[0])
		} catch (error) {
			throw error
		}
	}

	/**
	 * Cambiar contraseña de admin
	 */
	async updatePassword(id: number, newPasswordHash: string): Promise<void> {
		try {
			await db.execute({
				sql: `
					UPDATE Admins
					SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
					WHERE id = ?
				`,
				args: [newPasswordHash, id],
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * Activar/desactivar admin
	 */
	async setActive(id: number, isActive: boolean): Promise<void> {
		try {
			await db.execute({
				sql: `
					UPDATE Admins
					SET is_active = ?, updated_at = CURRENT_TIMESTAMP
					WHERE id = ?
				`,
				args: [isActive, id],
			})
		} catch (error) {
			throw error
		}
	}

	// ===== ESTADÍSTICAS =====

	/**
	 * Obtener conteo de admins (debería ser siempre 0 o 1)
	 */
	async count(): Promise<number> {
		try {
			const result = await db.execute({
				sql: 'SELECT COUNT(*) as total FROM Admins',
				args: [],
			})

			return Number(result.rows[0]?.total || 0)
		} catch (error) {
			throw error
		}
	}

	/**
	 * Validar que solo exista 1 admin (check de integridad)
	 */
	async validateSingleAdmin(): Promise<boolean> {
		try {
			const count = await this.count()

			if (count > 1) {
				return false
			}

			return true
		} catch (error) {
			throw error
		}
	}
}

// Singleton instance
export const adminsRepository = new AdminsRepository()
