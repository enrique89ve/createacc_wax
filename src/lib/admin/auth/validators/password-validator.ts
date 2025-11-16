/**
 * Password validation module for management area authentication
 * Handles admin and referral user credential validation
 *
 * @deprecated Use validateCredentials from unified-validator instead
 */

import {
  validateCredentials,
  type PasswordCredentials,
  type ValidationResult,
} from './unified-validator'

export type PasswordValidationResult = ValidationResult

/**
 * Validates password-based authentication for management area
 * @deprecated Use validateCredentials(credentials, 'password') from unified-validator
 */
export async function validatePasswordCredentials(
  credentials: PasswordCredentials
): Promise<PasswordValidationResult> {
  return validateCredentials(credentials, 'password')
}
