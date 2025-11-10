/**
 * Unified credential validator using strategy pattern
 * Eliminates code duplication between password and keychain validators
 */

import { verifyPasswordAuth } from '@/lib/admin/auth/password'
import { verifyKeychainAuth } from '@/lib/admin/auth/keychain'

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
	readonly role: 'admin' | 'builder'
	readonly auth_method: 'password' | 'keychain'
	readonly loginTime: number
}

export interface ValidationResult {
	readonly success: boolean
	readonly user?: {
		readonly id?: string
		readonly username: string
		readonly role: string
	}
	readonly error?: string
}

type AuthStrategy = 'password' | 'keychain'

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
				error: 'Username is required'
			}
		}

		// Strategy-specific validation
		const validator = getValidator(strategy)
		const validationError = validator.validate(credentials)

		if (validationError) {
			return {
				success: false,
				error: validationError
			}
		}

		// Authenticate using strategy
		const authResult = await validator.authenticate(credentials)

		if (authResult.success && authResult.user) {
			return {
				success: true,
				user: {
					id: authResult.user.id?.toString(),
					username: authResult.user.username || credentials.username,
					role: authResult.user.role || (strategy === 'keychain' ? 'builder' : '')
				}
			}
		}

		return {
			success: false,
			error: strategy === 'password' ? 'Invalid credentials' : 'Invalid keychain signature'
		}
	} catch (error) {
		return {
			success: false,
			error: 'Authentication failed'
		}
	}
}

/**
 * Strategy interface for different authentication methods
 * Usa genéricos para type-safe credentials
 */
interface AuthenticationStrategy<TCredentials extends BaseCredentials = BaseCredentials> {
	validate(credentials: TCredentials): string | null
	authenticate(credentials: TCredentials): Promise<AuthenticatedUserResult | null>
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

	authenticate(credentials: PasswordCredentials) {
		return verifyPasswordAuth({
			username: credentials.username,
			password: credentials.password
		})
	}
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

	authenticate(credentials: KeychainCredentials) {
		return verifyKeychainAuth({
			username: credentials.username,
			message: credentials.message,
			publicKey: credentials.publicKey || '',
			signature: credentials.signature || '',
			timestamp: credentials.timestamp || Date.now()
		})
	}
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