/**
 * Password validation module for management area authentication
 * Handles admin and referral user credential validation
 *
 * @deprecated Use validateCredentials from unified-validator instead
 */

import {
	validateCredentials,
	type PasswordCredentials,
	type ValidationResult
} from './unified-validator'

export interface PasswordValidationResult extends ValidationResult {
	readonly user?: {
		readonly id: string
		readonly username: string
		readonly role: string
	}
}

/**
 * Validates password-based authentication for management area
 * @deprecated Use validateCredentials(credentials, 'password') from unified-validator
 */
export async function validatePasswordCredentials(
	credentials: PasswordCredentials
): Promise<PasswordValidationResult> {
	const result = await validateCredentials(credentials, 'password')

	return {
		success: result.success,
		user: result.user ? {
			id: result.user.id || '',
			username: result.user.username,
			role: result.user.role
		} : undefined,
		error: result.error
	}
}