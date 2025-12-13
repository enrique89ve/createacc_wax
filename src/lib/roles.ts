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

/**
 * Role permissions mapping for future RBAC expansion
 * Defines what each role can do
 */
export const RolePermissions = {
	[UserRole.Admin]: [
		'manage_builders',
		'manage_all_tickets',
		'view_system_stats',
		'assign_credits',
		'delete_any_ticket',
		'view_all_tickets',
	],
	[UserRole.Builder]: [
		'manage_own_tickets',
		'view_own_credits',
		'claim_credits',
		'delete_own_ticket',
		'view_own_tickets',
	],
} as const

export type Permission =
	(typeof RolePermissions)[UserRole][number]

/**
 * Check if a role has a specific permission
 * @param role - The user role to check
 * @param permission - The permission to verify
 * @returns True if the role has the permission
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
	const permissions = RolePermissions[role] as readonly string[]
	return permissions.includes(permission)
}
