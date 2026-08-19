import bcrypt from 'bcryptjs'
import { db } from '@/lib/database'
import type { NewUser } from '@/lib/schemas/users'
import { logger } from '@/lib/logger'

export interface PasswordAuthRequest {
  readonly username: string
  readonly password: string
}

export interface AuthResult {
  readonly success: boolean
  readonly user?: NewUser & { role?: string }
  readonly error?: string
}

/** Partial row from SELECT id, username, password_hash, role, created_at, updated_at */
interface AdminUserRow {
  readonly id: string
  readonly username: string
  readonly password_hash: string | null
  readonly role: string
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Get user by username for password authentication
 * Case-insensitive username lookup
 */
async function getUserByUsername(
  username: string
): Promise<(NewUser & { role: string }) | null> {
  try {
    // Enforce role='admin' to ensure only admins can use password authentication
    const result = await db.execute({
      sql: `SELECT id, username, password_hash, role, created_at, updated_at FROM "user" WHERE LOWER(username) = LOWER(?) AND role = 'admin' AND is_active = 1 LIMIT 1`,
      args: [username],
    })

    if (result.rows.length === 0) return null

    const user = result.rows[0] as unknown as AdminUserRow
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      hive_account: null,
      auth_method: 'password',
      password_hash: user.password_hash,
      credits: 0,
      created_at: user.created_at,
      updated_at: user.updated_at,
    }
  } catch (error) {
    logger.error('Error getting user:', error)
    return null
  }
}

/**
 * Verifies authentication by user/password
 */
export async function verifyPasswordAuth(
  request: PasswordAuthRequest
): Promise<AuthResult> {
  try {
    const { username, password } = request

    // Validate required fields
    if (!username || !password) {
      return {
        success: false,
        error: 'Username y password requeridos',
      }
    }

    // Get user
    const user = await getUserByUsername(username)
    if (!user) {
      return {
        success: false,
        error: 'Usuario no encontrado',
      }
    }

    // Verify password
    if (!user.password_hash) {
      return {
        success: false,
        error: 'Configuración de usuario inválida',
      }
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash)
    if (!passwordMatch) {
      return {
        success: false,
        error: 'Credenciales inválidas',
      }
    }

    return {
      success: true,
      user,
    }
  } catch (error) {
    logger.error('Error en verificación de contraseña:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}
