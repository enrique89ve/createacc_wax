/**
 * User schema definitions for auth system
 * Simplified to match actual database structure (Admins + Builders)
 */

export type AuthMethod = 'password' | 'keychain'

/**
 * Unified user type for session management
 * Maps both Admins and Builders to a common interface
 */
export interface NewUser {
	id: number
	username: string | null
	hive_account: string | null
	auth_method: AuthMethod
	password_hash: string | null
	credits: number
	created_at: string
	updated_at: string
}
