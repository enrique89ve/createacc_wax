/**
 * Centralized role management for HolaHive authentication
 * Single source of truth for all role-related logic
 *
 * @module roles
 */

/**
 * User roles enum - The single source of truth for roles
 * Values match database values for compatibility
 */
export enum UserRole {
  Admin = 'admin',
  Builder = 'builder',
}

/**
 * Type guard to validate if a value is a valid UserRole
 * @param value - The value to check
 * @returns True if value is a valid UserRole
 */
export function isValidRole(value: unknown): value is UserRole {
  return (
    typeof value === 'string' &&
    Object.values(UserRole).includes(value as UserRole)
  )
}

/**
 * Assertion function that throws if role is invalid
 * Use when you need to guarantee a valid role or fail
 * @param value - The value to validate
 * @param context - Optional context for error message
 * @throws Error if value is not a valid UserRole
 */
export function assertValidRole(
  value: unknown,
  context?: string
): asserts value is UserRole {
  if (!isValidRole(value)) {
    const ctx = context ? ` [${context}]` : ''
    throw new Error(`Invalid role: ${String(value)}${ctx}`)
  }
}

/**
 * Safely parse a value to UserRole, returning null if invalid
 * Use when you want to handle invalid roles gracefully without throwing
 * @param value - The value to parse
 * @returns The UserRole if valid, null otherwise
 */
export function parseRole(value: unknown): UserRole | null {
  return isValidRole(value) ? value : null
}
