/**
 * Authentication guards and utilities for route protection
 * Provides type-safe helpers for different auth areas
 *
 * Nueva arquitectura:
 * - Admin: username/password tradicional (tabla Admins)
 * - Builder: autenticación vía Keychain (tabla Builders)
 */

import { getSession } from 'auth-astro/server'
import type { APIContext } from 'astro'
import { ROUTES } from '@/consts/constants'

/**
 * Auth.js session structure
 * Tipado explícito para sesiones de auth-astro
 */
interface AuthSession {
	user: {
		id: string
		username?: string
		hive_username?: string
		role: 'admin' | 'builder'
		auth_method: 'password' | 'keychain'
		loginTime?: number
	}
}

export interface AdminUser {
	readonly id: number
	readonly username: string
	readonly role: 'admin'
	readonly auth_method: 'password'
	readonly loginTime: number
}

export interface BuilderUser {
	readonly id: number
	readonly hive_username: string
	readonly role: 'builder'
	readonly auth_method: 'keychain'
	readonly loginTime: number
}

export type AuthenticatedUser = AdminUser | BuilderUser

export interface AuthGuardResult {
	readonly isAuthenticated: boolean
	readonly user?: AuthenticatedUser
	readonly redirectTo?: string
}

type AuthArea = 'admin' | 'builders'

/**
 * Unified session validation for all auth areas
 * Eliminates code duplication between guards
 */
async function validateSession(request: Request, area: AuthArea): Promise<AuthGuardResult> {
	const session = await getSession(request)

	// Area-specific validation
	const validationResult = area === 'admin'
		? validateAdminSession(session)
		: validateBuildersSession(session)

	if (!validationResult.isValid) {
		return {
			isAuthenticated: false,
			redirectTo: validationResult.redirectTo
		}
	}

	const { user } = session!

	// Return typed user based on area
	if (area === 'admin') {
		return {
			isAuthenticated: true,
			user: {
				id: Number(user.id),
				username: user.username,
				role: 'admin' as const,
				auth_method: 'password' as const,
				loginTime: user.loginTime || Date.now()
			}
		}
	} else {
		const username = user.hive_username || user.username
		return {
			isAuthenticated: true,
			user: {
				id: Number(user.id),
				hive_username: username,
				role: 'builder' as const,
				auth_method: 'keychain' as const,
				loginTime: user.loginTime || Date.now()
			} satisfies BuilderUser
		}
	}
}

/**
 * Validates admin session requirements
 */
function validateAdminSession(
	session: AuthSession | null
): { isValid: boolean; redirectTo?: string } {
	if (!session?.user?.id) {
		return { isValid: false, redirectTo: ROUTES.LOGIN }
	}

	// Admin debe tener role === 'admin'
	if (session.user.role !== 'admin') {
		return { isValid: false, redirectTo: ROUTES.LOGIN }
	}

	return { isValid: true }
}

/**
 * Validates builders session requirements
 */
function validateBuildersSession(
	session: AuthSession | null
): { isValid: boolean; redirectTo?: string } {
	if (!session?.user?.id) {
		return { isValid: false, redirectTo: '/builders/login' }
	}

	// Builder debe tener role === 'builder'
	if (session.user.role !== 'builder') {
		return { isValid: false, redirectTo: '/builders/login' }
	}

	return { isValid: true }
}

/**
 * Guard for admin area - requires admin authentication
 */
export async function requireAdminAuth(request: Request): Promise<AuthGuardResult> {
	return validateSession(request, 'admin')
}

/**
 * Guard for builders area - requires builder authentication via Keychain
 */
export async function requireBuildersAuth(request: Request): Promise<AuthGuardResult> {
	return validateSession(request, 'builders')
}

/**
 * Helper for Astro pages - automatically handles redirects
 */
export async function getAuthenticatedUser(
	context: Pick<APIContext, 'request' | 'redirect'>,
	area: 'admin' | 'builders' = 'admin'
) {
	const guard = area === 'admin' ? requireAdminAuth : requireBuildersAuth
	const result = await guard(context.request)

	if (!result.isAuthenticated && result.redirectTo) {
		return context.redirect(result.redirectTo)
	}

	return result.user
}

/**
 * Check if user is admin
 */
export function isAdmin(user: AuthenticatedUser): boolean {
	return user.role === 'admin'
}

/**
 * Check if user is builder
 */
export function isBuilder(user: AuthenticatedUser): boolean {
	return user.role === 'builder'
}

/**
 * Type guard for AdminUser
 */
export function isAdminUser(user: AuthenticatedUser): user is AdminUser {
	return user.role === 'admin'
}

/**
 * Type guard for BuilderUser
 */
export function isBuilderUser(user: AuthenticatedUser): user is BuilderUser {
	return user.role === 'builder'
}