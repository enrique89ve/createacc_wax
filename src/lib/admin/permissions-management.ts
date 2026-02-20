/**
 * RBAC Permission System for Management Area
 * Extends the base permissions.ts to work with AdminSession (UserRole.Admin | UserRole.Builder)
 * Eliminates code duplication in permission checks
 */

import type { AdminSession } from '@/types/auth'
import { UserRole } from '@/lib/roles'

// ===== MANAGEMENT PERMISSIONS =====

/**
 * Permission requirements for management operations
 * Maps to AdminSession roles using UserRole enum
 */
export const MANAGEMENT_OPERATIONS = {
	// User Management (Admin only)
	MANAGE_BUILDERS: UserRole.Admin,
	CREATE_BUILDER: UserRole.Admin,
	DELETE_BUILDER: UserRole.Admin,
	ASSIGN_CREDITS: UserRole.Admin,

	// Ticket Management
	VIEW_ALL_TICKETS: UserRole.Admin, // Admin can see all tickets
	VIEW_OWN_TICKETS: UserRole.Builder, // Builder can see only their tickets
	CREATE_TICKET: [UserRole.Admin, UserRole.Builder], // Both can create
	DELETE_OWN_TICKET: UserRole.Builder, // Builder can delete their own
	DELETE_ANY_TICKET: UserRole.Admin, // Admin can delete any

	// Console Access
	ACCESS_CONSOLE: [UserRole.Admin, UserRole.Builder], // Both can access
	VIEW_SYSTEM_STATS: UserRole.Admin, // Only admin sees full stats

	// Credits Operations
	CLAIM_CREDITS: UserRole.Builder, // Builder claims pending credits
	VIEW_OWN_CREDITS: UserRole.Builder, // Builder views their credits
	MANAGE_ALL_CREDITS: UserRole.Admin, // Admin manages all credits
} as const

export type ManagementOperation = keyof typeof MANAGEMENT_OPERATIONS

// ===== PERMISSION CHECKING =====

/**
 * Check if session has permission for an operation
 */
export function canPerform(
	session: AdminSession | null | undefined,
	operation: ManagementOperation
): boolean {
	if (!session) return false

	const required = MANAGEMENT_OPERATIONS[operation]

	// Handle array of allowed roles
	if (Array.isArray(required)) {
		return required.includes(session.role)
	}

	// Handle single role requirement
	return session.role === required
}

/**
 * Assert that session has permission, throw if not
 * Use in API routes for authorization
 */
export function assertCanPerform(
	session: AdminSession | null | undefined,
	operation: ManagementOperation,
	context?: string
): asserts session is AdminSession {
	if (!canPerform(session, operation)) {
		const role = session?.role || 'anonymous'
		const contextMsg = context ? ` [${context}]` : ''
		throw new Error(`Unauthorized: ${role} cannot perform ${operation}${contextMsg}`)
	}
}

/**
 * Check if session is admin
 * Convenience function for common check
 */
export function isAdmin(
	session: AdminSession | null | undefined
): session is AdminSession {
	return session?.role === UserRole.Admin
}

/**
 * Check if session is builder
 * Convenience function for common check
 */
export function isBuilder(
	session: AdminSession | null | undefined
): session is AdminSession {
	return session?.role === UserRole.Builder
}

/**
 * Assert admin role, throw if not
 * Use for admin-only routes
 */
export function assertAdmin(
	session: AdminSession | null | undefined,
	context?: string
): asserts session is AdminSession {
	assertCanPerform(session, 'MANAGE_BUILDERS', context)
}

/**
 * Assert builder role, throw if not
 * Use for builder-only routes
 */
export function assertBuilder(
	session: AdminSession | null | undefined,
	context?: string
): asserts session is AdminSession {
	assertCanPerform(session, 'CLAIM_CREDITS', context)
}

// ===== API HELPERS =====

/**
 * Create unauthorized response
 * Standard format for 403 errors
 */
export function unauthorizedResponse(
	message: string = 'No autorizado'
): Response {
	return new Response(JSON.stringify({ error: message }), {
		status: 403,
		headers: { 'Content-Type': 'application/json' },
	})
}

/**
 * Wrapper for API routes that require specific operation permission
 * Automatically returns 403 if unauthorized
 */
export function requireOperation(
	session: AdminSession | null | undefined,
	operation: ManagementOperation
): session is AdminSession {
	return canPerform(session, operation)
}

// ===== PERMISSION DESCRIPTIONS =====

/**
 * Human-readable descriptions for operations
 * Useful for UI and error messages
 */
export const OPERATION_DESCRIPTIONS: Record<ManagementOperation, string> = {
	MANAGE_BUILDERS: 'Gestionar usuarios builders',
	CREATE_BUILDER: 'Crear nuevo builder',
	DELETE_BUILDER: 'Eliminar builder',
	ASSIGN_CREDITS: 'Asignar créditos a builders',
	VIEW_ALL_TICKETS: 'Ver todos los tickets',
	VIEW_OWN_TICKETS: 'Ver tickets propios',
	CREATE_TICKET: 'Crear tickets',
	DELETE_OWN_TICKET: 'Eliminar tickets propios',
	DELETE_ANY_TICKET: 'Eliminar cualquier ticket',
	ACCESS_CONSOLE: 'Acceder al console',
	VIEW_SYSTEM_STATS: 'Ver estadísticas del sistema',
	CLAIM_CREDITS: 'Reclamar créditos pendientes',
	VIEW_OWN_CREDITS: 'Ver créditos propios',
	MANAGE_ALL_CREDITS: 'Gestionar todos los créditos',
}

/**
 * Get description for operation
 */
export function getOperationDescription(
	operation: ManagementOperation
): string {
	return OPERATION_DESCRIPTIONS[operation]
}
