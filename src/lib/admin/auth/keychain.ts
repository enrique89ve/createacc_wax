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
    const { username, message, publicKey, signature } = request

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

    // Validación de formato del mensaje (incluye nonce obligatorio)
    const messageRegex =
      /Login to HiveAccount Creation at .+\nUsername: (.+)\nTimestamp: (\d+)\nNonce: ([a-f0-9]{64})$/
    const messageMatch = message.match(messageRegex)

    if (!messageMatch) {
      return {
        success: false,
        error: 'Formato de mensaje inválido',
      }
    }

    const messageUsername = messageMatch[1]
    const messageTimestamp = parseInt(messageMatch[2])
    const messageNonce = messageMatch[3]

    // Validar que el username coincida
    if (messageUsername !== username) {
      return {
        success: false,
        error: 'Username no coincide en el mensaje',
      }
    }

    // Validar nonce del servidor (one-time use, previene replay attacks)
    const { consumeNonce } = await import('@/lib/nonce-store')
    if (!consumeNonce(messageNonce)) {
      return {
        success: false,
        error: 'Nonce inválido, expirado o ya utilizado. Intenta de nuevo.',
      }
    }

    // Validar timestamp del mensaje
    // IMPORTANTE: Usar siempre la hora del servidor (Date.now()) para evitar ataques de replay.
    // Date.now() es UTC universal, por lo que la zona horaria del usuario no afecta,
    // pero sí afecta si su reloj está desajustado (adelantado o atrasado).
    const now = Date.now()

    // Con nonce de uso único, la ventana de timestamp puede ser más estricta (2 min)
    const maxDiff = 2 * 60 * 1000
    const messageTimeDiff = Math.abs(now - messageTimestamp)

    if (messageTimeDiff > maxDiff) {
      return {
        success: false,
        error:
          'La hora de tu dispositivo está desajustada. Por favor verifica tu reloj e intenta de nuevo.',
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
    // SEGURIDAD: Columnas explícitas - NO incluir password_hash
    const builderResult = await db.execute({
      sql: 'SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM Users WHERE username = ? AND role = ? AND is_active = TRUE',
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
