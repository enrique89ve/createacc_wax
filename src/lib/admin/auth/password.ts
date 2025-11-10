import bcrypt from 'bcryptjs'
import { db } from '@/lib/database'
import type { NewUser } from '@/lib/schemas/users'

export interface PasswordAuthRequest {
  readonly username: string
  readonly password: string
}

export interface AuthResult {
  readonly success: boolean
  readonly user?: NewUser
  readonly error?: string
}

/**
 * Get admin user for password authentication
 * Uses Admins table (only 1 admin allowed)
 */
async function getSuperAdminUser(): Promise<NewUser | null> {
  try {
    const result = await db.execute({
      sql: `SELECT id, username, password_hash, created_at, updated_at FROM Admins WHERE is_active = TRUE LIMIT 1`,
      args: []
    })

    if (result.rows.length === 0) return null

    const admin = result.rows[0] as any
    return {
      id: admin.id,
      username: admin.username,
      hive_account: null,
      auth_method: 'password',
      password_hash: admin.password_hash,
      credits: 0,
      created_at: admin.created_at,
      updated_at: admin.updated_at,
    } as NewUser
  } catch (error) {
    console.error('Error getting admin user:', error)
    return null
  }
}

/**
 * Verifica autenticación por usuario/contraseña para superadmins
 */
export async function verifyPasswordAuth(
  request: PasswordAuthRequest
): Promise<AuthResult> {
  try {
    const { username, password } = request

    // Validar campos requeridos
    if (!username || !password) {
      return {
        success: false,
        error: 'Username y password requeridos',
      }
    }

    // Obtener usuario superadmin
    const superAdminUser = await getSuperAdminUser()
    if (!superAdminUser) {
      return {
        success: false,
        error: 'Usuario no encontrado',
      }
    }

    // Verificar username
    if (superAdminUser.username !== username) {
      return {
        success: false,
        error: 'Credenciales inválidas',
      }
    }

    // Verificar contraseña
    if (!superAdminUser.password_hash) {
      return {
        success: false,
        error: 'Configuración de usuario inválida',
      }
    }

    const passwordMatch = await bcrypt.compare(
      password,
      superAdminUser.password_hash
    )
    if (!passwordMatch) {
      return {
        success: false,
        error: 'Credenciales inválidas',
      }
    }

    return {
      success: true,
      user: superAdminUser,
    }
  } catch (error) {
    console.error('Error en verificación de contraseña:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}
