/**
 * Utilities for type-safe environment variable management
 * Environment variables loaded from .env.local (same file for dev and prod)
 */

import { ENV_KEYS } from '@/consts/constants'

/**
 * Gets an environment variable as a string with validation
 * @param name - Environment variable key
 * @returns Trimmed value or empty string if it does not exist
 */
export function getEnvString(name: keyof ImportMetaEnv): string {
	const value = import.meta.env[name]
	return typeof value === 'string' ? value.trim() : ''
}

/**
 * Gets a required environment variable as a string
 * @param name - Environment variable key
 * @throws Error if the variable does not exist or is empty
 */
export function getRequiredEnvString(name: keyof ImportMetaEnv): string {
	const value = getEnvString(name)
	if (!value) {
		throw new Error(`Required environment variable ${name} is missing or empty`)
	}
	return value
}

/**
 * Converts a string environment variable to boolean
 * @param name - Environment variable key
 * @returns true if the value is "TRUE", false otherwise
 */
export function getBooleanEnv(name: keyof ImportMetaEnv): boolean {
	const value = import.meta.env[name]
	return typeof value === 'string' && value.toUpperCase() === 'TRUE'
}

/**
 * Evaluates if a process.env value is truthy (true/1/yes)
 * Useful for variables that are not in import.meta.env (e.g. runtime-only vars)
 */
export function isTruthyProcessEnv(name: string): boolean {
	const value = process.env[name]
	if (!value) return false
	const normalized = value.trim().toLowerCase()
	return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

/**
 * Validates that all required environment variables are present
 * @throws Error if any required variable is missing
 */
export function validateEnvironment(): void {
	const required: (keyof ImportMetaEnv)[] = [
		ENV_KEYS.HIVE_CREATOR_ACCOUNT,
		ENV_KEYS.HIVE_CREATOR_ACTIVE_KEY,
		ENV_KEYS.HIVE_DELEGATOR_ACCOUNT,
		ENV_KEYS.HIVE_DELEGATOR_POSTING_KEY,
		ENV_KEYS.SESSION_SECRET,
		ENV_KEYS.BEEKEEPER_WALLET_PASSWORD,
	]

	for (const key of required) {
		getRequiredEnvString(key)
	}

	// SESSION_SECRET must be at least 32 characters for HMAC-SHA256 security
	const sessionSecret = getEnvString(ENV_KEYS.SESSION_SECRET)
	if (sessionSecret.length < 32) {
		throw new Error('SESSION_SECRET must be at least 32 characters for secure HMAC-SHA256 signing')
	}
}