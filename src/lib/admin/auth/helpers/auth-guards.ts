/**
 * Authentication guards and utilities for route protection
 * Provides type-safe helpers for different auth areas
 *
 * Nueva arquitectura:
 * - Admin: username/password tradicional (tabla Users con role='admin')
 * - Builder: autenticación vía Keychain (tabla Users con role='builder')
 */

import { getSession } from 'auth-astro/server'
import type { APIContext } from 'astro'
import type { Session } from '@auth/core/types'
import { ROUTES } from '@/consts/constants'
import { UserRole } from '@/lib/roles'

export interface AdminUser {
  readonly id: number
  readonly username: string
  readonly role: typeof UserRole.Admin
  readonly auth_method: 'password'
  readonly loginTime: number
}

export interface BuilderUser {
  readonly id: number
  readonly username: string
  readonly role: typeof UserRole.Builder
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
async function validateSession(
  request: Request,
  area: AuthArea
): Promise<AuthGuardResult> {
  const session = await getSession(request)

  // Area-specific validation
  const validationResult =
    area === 'admin'
      ? validateAdminSession(session)
      : validateBuildersSession(session)

  if (!validationResult.isValid) {
    return {
      isAuthenticated: false,
      redirectTo: validationResult.redirectTo,
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
        role: UserRole.Admin,
        auth_method: 'password' as const,
        loginTime: user.loginTime || Date.now(),
      },
    }
  } else {
    return {
      isAuthenticated: true,
      user: {
        id: Number(user.id),
        username: user.username,
        role: UserRole.Builder,
        auth_method: 'keychain' as const,
        loginTime: user.loginTime || Date.now(),
      } satisfies BuilderUser,
    }
  }
}

/**
 * Validates admin session requirements
 */
function validateAdminSession(session: Session | null): {
  isValid: boolean
  redirectTo?: string
} {
  if (!session?.user?.id) {
    return { isValid: false, redirectTo: ROUTES.LOGIN }
  }

  // Admin debe tener role === UserRole.Admin
  if (session.user.role !== UserRole.Admin) {
    return { isValid: false, redirectTo: ROUTES.LOGIN }
  }

  return { isValid: true }
}

/**
 * Validates builders session requirements
 */
function validateBuildersSession(session: Session | null): {
  isValid: boolean
  redirectTo?: string
} {
  if (!session?.user?.id) {
    return { isValid: false, redirectTo: ROUTES.BUILDERS_LOGIN }
  }

  // Builder debe tener role === UserRole.Builder
  if (session.user.role !== UserRole.Builder) {
    return { isValid: false, redirectTo: ROUTES.BUILDERS_LOGIN }
  }

  // Para builders autenticados vía Keychain, hive_username nunca debe faltar
  if (!session.user.username) {
    return { isValid: false, redirectTo: ROUTES.BUILDERS_LOGIN }
  }

  return { isValid: true }
}

/**
 * Guard for admin area - requires admin authentication
 */
export async function requireAdminAuth(
  request: Request
): Promise<AuthGuardResult> {
  return validateSession(request, 'admin')
}

/**
 * Guard for builders area - requires builder authentication via Keychain
 */
export async function requireBuildersAuth(
  request: Request
): Promise<AuthGuardResult> {
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
  return user.role === UserRole.Admin
}

/**
 * Check if user is builder
 */
export function isBuilder(user: AuthenticatedUser): boolean {
  return user.role === UserRole.Builder
}

/**
 * Type guard for AdminUser
 */
export function isAdminUser(user: AuthenticatedUser): user is AdminUser {
  return user.role === UserRole.Admin
}

/**
 * Type guard for BuilderUser
 */
export function isBuilderUser(user: AuthenticatedUser): user is BuilderUser {
  return user.role === UserRole.Builder
}
