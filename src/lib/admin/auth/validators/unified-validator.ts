/**
 * Unified credential validator using strategy pattern
 * Eliminates code duplication between password and keychain validators
 */

import { verifyPasswordAuth } from '@/lib/admin/auth/password'
import { verifyKeychainAuth } from '@/lib/admin/auth/keychain'
import {
  createHiveMessage,
  createHivePublicKey,
  createHiveSignature,
  createHiveUsername,
} from '@/types/hive-signature'
import { UserRole } from '@/lib/roles'

export interface BaseCredentials {
  readonly username: string
  readonly type: 'password' | 'keychain'
}

export interface PasswordCredentials extends BaseCredentials {
  readonly type: 'password'
  readonly password: string
}

export interface KeychainCredentials extends BaseCredentials {
  readonly type: 'keychain'
  readonly message: string
  readonly publicKey?: string
  readonly signature?: string
  readonly timestamp?: number
}

export type AuthCredentials = PasswordCredentials | KeychainCredentials

/**
 * Result type for authenticated user
 */
export interface AuthenticatedUserResult {
  readonly id: string
  readonly username: string
  readonly role: UserRole
  readonly auth_method: 'password' | 'keychain'
  readonly loginTime: number
}

interface ValidationSuccessResult {
  readonly success: true
  readonly user: AuthenticatedUserResult
}

interface ValidationFailureResult {
  readonly success: false
  readonly error: string
}

export type ValidationResult = ValidationSuccessResult | ValidationFailureResult

type AuthStrategy = 'password' | 'keychain'

interface StrategyAuthSuccess {
  readonly success: true
  readonly user: AuthenticatedUserResult
}

interface StrategyAuthFailure {
  readonly success: false
  readonly error?: string
}

type StrategyAuthResult = StrategyAuthSuccess | StrategyAuthFailure

const DEFAULT_ERROR_BY_STRATEGY: Record<AuthStrategy, string> = {
  password: 'Invalid credentials',
  keychain: 'Invalid keychain signature',
}

/**
 * Validates credentials using the specified authentication strategy
 */
export async function validateCredentials<T extends BaseCredentials>(
  credentials: T,
  strategy: AuthStrategy
): Promise<ValidationResult> {
  try {
    // Basic validation
    if (!credentials.username) {
      return {
        success: false,
        error: 'Username is required',
      }
    }

    // Strategy-specific validation
    const validator = getValidator(strategy)
    const validationError = validator.validate(credentials)

    if (validationError) {
      return {
        success: false,
        error: validationError,
      }
    }

    // Authenticate using strategy
    const authResult = await validator.authenticate(credentials)

    if (authResult.success) {
      return {
        success: true,
        user: authResult.user,
      }
    }

    return {
      success: false,
      error: authResult.error || DEFAULT_ERROR_BY_STRATEGY[strategy],
    }
  } catch (error) {
    return {
      success: false,
      error: 'Authentication failed',
    }
  }
}

/**
 * Strategy interface for different authentication methods
 * Usa genéricos para type-safe credentials
 */
interface AuthenticationStrategy<
  TCredentials extends BaseCredentials = BaseCredentials,
> {
  validate(credentials: TCredentials): string | null
  authenticate(credentials: TCredentials): Promise<StrategyAuthResult>
}

/**
 * Password authentication strategy
 */
const passwordStrategy: AuthenticationStrategy<PasswordCredentials> = {
  validate(credentials: PasswordCredentials): string | null {
    if (!credentials.password) {
      return 'Password is required'
    }
    return null
  },

  async authenticate(credentials: PasswordCredentials) {
    const passwordResult = await verifyPasswordAuth({
      username: credentials.username,
      password: credentials.password,
    })

    if (!passwordResult.success || !passwordResult.user) {
      return {
        success: false,
        error: passwordResult.error,
      }
    }

    return {
      success: true,
      user: {
        id: passwordResult.user.id.toString(),
        username: passwordResult.user.username || credentials.username,
        role: UserRole.Admin,
        auth_method: 'password',
        loginTime: Date.now(),
      },
    }
  },
}

/**
 * Keychain authentication strategy
 */
const keychainStrategy: AuthenticationStrategy<KeychainCredentials> = {
  validate(credentials: KeychainCredentials): string | null {
    if (!credentials.message) {
      return 'Signed message is required'
    }
    return null
  },

  async authenticate(credentials: KeychainCredentials) {
    const keychainResult = await verifyKeychainAuth({
      username: createHiveUsername(credentials.username),
      message: createHiveMessage(credentials.message),
      publicKey: credentials.publicKey
        ? createHivePublicKey(credentials.publicKey)
        : undefined,
      signature: credentials.signature
        ? createHiveSignature(credentials.signature)
        : undefined,
    })

    if (!keychainResult.success || !keychainResult.user) {
      return {
        success: false,
        error: keychainResult.error,
      }
    }

    return {
      success: true,
      user: {
        id: keychainResult.user.id?.toString() || credentials.username,
        username: keychainResult.user.username || credentials.username,
        role: UserRole.Builder,
        auth_method: 'keychain',
        loginTime: Date.now(),
      },
    }
  },
}

/**
 * Get validator strategy based on auth method
 */
function getValidator(strategy: AuthStrategy): AuthenticationStrategy {
  switch (strategy) {
    case 'password':
      return passwordStrategy
    case 'keychain':
      return keychainStrategy
    default:
      throw new Error(`Unsupported authentication strategy: ${strategy}`)
  }
}
