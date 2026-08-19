import { db } from '@/lib/database'
import type { NewUser } from '@/lib/schemas/users'
import type {
  HiveUsername,
  HiveMessage,
  HivePublicKey,
  HiveSignature,
} from '@/types/hive-signature'
import { logger } from '@/lib/logger'
import { sqliteToBoolean } from '@/utils/sqlite-helpers'

/** Partial row from SELECT id, username, role, is_active, last_claim_at, created_at, updated_at */
interface BuilderRow {
  readonly id: string
  readonly username: string
  readonly role: string
  readonly is_active: boolean | number
  readonly last_claim_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

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
 * Verifies authentication via Hive Keychain
 * Reuses the verification logic from keychain-login.ts
 */
export async function verifyKeychainAuth(
  request: KeychainAuthRequest
): Promise<AuthResult> {
  try {
    const { username, message, publicKey, signature } = request

    // Validate required fields
    if (!username || !message) {
      return {
        success: false,
        error: 'Username and message are required',
      }
    }

    // Validate that it is not an admin trying to use Keychain
    const adminCheck = await db.execute({
      sql: 'SELECT username FROM "user" WHERE username = ? AND role = ?',
      args: [username as string, 'admin'],
    })

    if (adminCheck.rows.length > 0) {
      return {
        success: false,
        error: 'Administrators must use password login',
      }
    }

    // Validate message format (includes mandatory nonce)
    const messageRegex =
      /Login to HiveAccount Creation at .+\nUsername: (.+)\nTimestamp: (\d+)\nNonce: ([a-f0-9]{64})$/
    const messageMatch = message.match(messageRegex)

    if (!messageMatch) {
      return {
        success: false,
        error: 'Invalid message format',
      }
    }

    const messageUsername = messageMatch[1]
    const messageTimestamp = parseInt(messageMatch[2])
    const messageNonce = messageMatch[3]

    // Validate that the username matches
    if (messageUsername !== username) {
      return {
        success: false,
        error: 'Username does not match the message',
      }
    }

    // Validate server nonce (one-time use, prevents replay attacks)
    const { consumeNonce } = await import('@/lib/nonce-store')
    if (!consumeNonce(messageNonce)) {
      return {
        success: false,
        error: 'Invalid, expired or already used nonce. Please try again.',
      }
    }

    // Validate message timestamp
    // IMPORTANT: Always use server time (Date.now()) to prevent replay attacks.
    // Date.now() is universal UTC, so the user's timezone does not affect it,
    // but it does affect if their clock is out of sync (fast or slow).
    const now = Date.now()

    // With single-use nonce, the timestamp window can be stricter (2 min)
    const maxDiff = 2 * 60 * 1000
    const messageTimeDiff = Math.abs(now - messageTimestamp)

    if (messageTimeDiff > maxDiff) {
      return {
        success: false,
        error:
          'Your device time is out of sync. Please check your clock and try again.',
      }
    }

    // Real cryptographic verification using WAX
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
        error: signatureResult.error || 'Invalid signature',
      }
    }

    // Find builder in the database (include inactive so we can reject bans)
    // SECURITY: Explicit columns - DO NOT include password_hash
    const builderResult = await db.execute({
      sql: 'SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM "user" WHERE username = ? AND role = ?',
      args: [username as string, 'builder'],
    })

    if (builderResult.rows.length === 0) {
      return {
        success: true,
        user: {
          id: '',
          username: username,
          hive_account: username,
          auth_method: 'keychain',
          password_hash: null,
          credits: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as NewUser,
      }
    }

    const builder = builderResult.rows[0] as unknown as BuilderRow
    if (!sqliteToBoolean(builder.is_active)) {
      return {
        success: false,
        error: 'Tu cuenta de builder está inactiva',
      }
    }

    const user: NewUser = {
      id: builder.id,
      username: builder.username,
      hive_account: builder.username,
      auth_method: 'keychain',
      password_hash: null,
      credits: 0,
      created_at: builder.created_at,
      updated_at: builder.updated_at,
    } as NewUser

    return {
      success: true,
      user,
    }
  } catch (error) {
    logger.error('Error in Keychain verification:', error)
    return {
      success: false,
      error: 'Internal server error',
    }
  }
}
