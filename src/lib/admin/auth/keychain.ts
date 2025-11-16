import { db } from '@/lib/database'
import type { NewUser } from '@/lib/schemas/users'
import type {
  HiveUsername,
  HiveMessage,
  HivePublicKey,
  HiveSignature,
} from '@/types/hive-signature'

export interface KeychainAuthRequest {
  readonly username: HiveUsername
  readonly message: HiveMessage
  readonly timestamp: number
  readonly publicKey?: HivePublicKey
  readonly signature?: HiveSignature
}

export interface AuthResult {
  readonly success: boolean
  readonly user?: NewUser
  readonly error?: string
}

/**
 * Verifica autenticación por Hive Keychain
 * Reutiliza la lógica de verificación de keychain-login.ts
 */
export async function verifyKeychainAuth(
  request: KeychainAuthRequest
): Promise<AuthResult> {
  try {
    const { username, message, publicKey, signature, timestamp } = request

    // Validar campos requeridos
    if (!username || !message) {
      return {
        success: false,
        error: 'Username y message requeridos',
      }
    }

    // Validar que no sea admin intentando usar Keychain
    const adminCheck = await db.execute({
      sql: 'SELECT username FROM Users WHERE username = ? AND role = ?',
      args: [username as string, 'admin'],
    })

    if (adminCheck.rows.length > 0) {
      return {
        success: false,
        error: 'Los administradores deben usar login con contraseña',
      }
    }

    // Validación básica de formato del mensaje
    const messageRegex = /Login to HiveAccount Creation at .+\nUsername: (.+)\nTimestamp: (\d+)$/
    const messageMatch = message.match(messageRegex)

    if (!messageMatch) {
      return {
        success: false,
        error: 'Formato de mensaje inválido',
      }
    }

    const messageUsername = messageMatch[1]
    const messageTimestamp = parseInt(messageMatch[2])

    // Validar que el username coincida
    if (messageUsername !== username) {
      return {
        success: false,
        error: 'Username no coincide en el mensaje',
      }
    }

    // Validar timestamp del mensaje (no más de 1 minuto de diferencia)
    const now = timestamp || Date.now()
    const maxDiff = 60_000 // 1 minuto en milisegundos
    const messageTimeDiff = Math.abs(now - messageTimestamp)

    if (messageTimeDiff > maxDiff) {
      return {
        success: false,
        error: 'Timestamp del mensaje inválido. El mensaje es muy antiguo.',
      }
    }

    // Verificación criptográfica real usando WAX
    const { quickVerifySignature } = await import(
      '@/lib/admin/auth/hive-signature-verifier'
    )
    const signatureResult = await quickVerifySignature({
      username,
      message,
      signature,
      publicKey,
    })

    if (!signatureResult.valid) {
      return {
        success: false,
        error: signatureResult.error || 'Signature inválida',
      }
    }

    // Buscar builder en la base de datos
    const builderResult = await db.execute({
      sql: 'SELECT * FROM Users WHERE username = ? AND role = ? AND is_active = TRUE',
      args: [username as string, 'builder'],
    })

    let user: NewUser

    if (builderResult.rows.length === 0) {
      // Builder no existe en BD - permitir acceso pero con 0 créditos
      // Crear objeto usuario temporal (no guardado en BD)
      user = {
        id: 0, // ID temporal
        username: username,
        hive_account: username,
        auth_method: 'keychain',
        password_hash: null,
        credits: 0, // 0 créditos hasta que admin asigne
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as NewUser
    } else {
      // Builder existe en BD
      const builder = builderResult.rows[0] as any

      // Mapear builder a formato de usuario para compatibilidad con sesión
      user = {
        id: builder.id,
        username: builder.username,
        hive_account: builder.username,
        auth_method: 'keychain',
        password_hash: null,
        credits: 0, // Los créditos se obtienen de la tabla Credits
        created_at: builder.created_at,
        updated_at: builder.updated_at,
      } as NewUser
    }

    return {
      success: true,
      user,
    }
  } catch (error) {
    console.error('Error en verificación de Keychain:', error)
    return {
      success: false,
      error: 'Error interno del servidor',
    }
  }
}
