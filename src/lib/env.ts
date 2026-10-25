/**
 * Runtime-only access to sensitive environment configuration.
 * Development loads .env.local before importing the server; production injects
 * values into process.env when the server starts.
 */

import { ENV_KEYS } from '@/consts/constants'

export type EnvironmentVariableName = (typeof ENV_KEYS)[keyof typeof ENV_KEYS]

function readEnvValue(name: EnvironmentVariableName): string {
  const fromProcess = process.env[name]
  if (typeof fromProcess === 'string' && fromProcess.trim().length > 0) {
    return fromProcess.trim()
  }

  return ''
}

/**
 * Gets an environment variable as a string with validation
 * @param name - Environment variable key
 * @returns Trimmed value or empty string if it does not exist
 */
export function getEnvString(name: EnvironmentVariableName): string {
  return readEnvValue(name)
}

/**
 * Gets a required environment variable as a string
 * @param name - Environment variable key
 * @throws Error if the variable does not exist or is empty
 */
export function getRequiredEnvString(name: EnvironmentVariableName): string {
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
export function getBooleanEnv(name: EnvironmentVariableName): boolean {
  const value = readEnvValue(name)
  return value.toUpperCase() === 'TRUE'
}

/**
 * Evaluates if a process.env value is truthy (true/1/yes)
 * Useful for process-only variables that are read at runtime.
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
const PUBLIC_CREATION_REQUIRED: EnvironmentVariableName[] = [
  ENV_KEYS.HIVE_CREATOR_ACCOUNT,
  ENV_KEYS.HIVE_CREATOR_ACTIVE_KEY,
  ENV_KEYS.HIVE_DELEGATOR_ACCOUNT,
  ENV_KEYS.HIVE_DELEGATOR_POSTING_KEY,
  ENV_KEYS.SESSION_SECRET,
  ENV_KEYS.BEEKEEPER_WALLET_PASSWORD,
]

function assertSessionSecretLength(): void {
  const sessionSecret = getEnvString(ENV_KEYS.SESSION_SECRET)
  if (sessionSecret.length < 32) {
    throw new Error(
      'SESSION_SECRET must be at least 32 characters for secure HMAC-SHA256 signing'
    )
  }
}

/** Env required for public account creation (home, details, create APIs). */
export function validatePublicCreationEnvironment(): void {
  for (const key of PUBLIC_CREATION_REQUIRED) {
    getRequiredEnvString(key)
  }
  assertSessionSecretLength()
}

/** Env required for admin/builder consoles (Better Auth). */
export function validateAdminEnvironment(): void {
  validatePublicCreationEnvironment()
  const authSecret = process.env.AUTH_SECRET?.trim() ?? ''
  if (authSecret.length < 32) {
    throw new Error(
      'AUTH_SECRET must be at least 32 characters for Better Auth'
    )
  }
}

/** @deprecated Prefer scoped validators above. */
export function validateEnvironment(): void {
  validateAdminEnvironment()
}
