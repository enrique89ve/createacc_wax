/**
 * Authentication guards and utilities for route protection
 *
 * Admin: username/password (Users table with role='admin')
 * Builder: Keychain (Users table with role='builder')
 *
 * Builder access is a discriminated state: anonymous | pending | active.
 * Pending = valid Keychain proof but not an active registered builder.
 */

import type { APIContext } from 'astro'
import { ROUTES } from '@/consts/constants'
import { UserRole } from '@/lib/roles'
import { getAppAuthSession, type AppAuthSession } from '@/lib/auth-session'

export interface AdminUser {
  readonly id: string
  readonly username: string
  readonly role: typeof UserRole.Admin
  readonly auth_method: 'password'
  readonly isActive: boolean
  readonly loginTime: number
}

export interface BuilderUser {
  readonly id: string
  readonly username: string
  readonly role: typeof UserRole.Builder
  readonly auth_method: 'keychain'
  readonly isActive: boolean
  readonly loginTime: number
}

export type AuthenticatedUser = AdminUser | BuilderUser

export type AdminAuthResult =
  | { readonly kind: 'anonymous'; readonly redirectTo: string }
  | { readonly kind: 'active'; readonly user: AdminUser }

export type BuilderAuthResult =
  | { readonly kind: 'anonymous'; readonly redirectTo: string }
  | { readonly kind: 'pending'; readonly username: string }
  | { readonly kind: 'active'; readonly user: BuilderUser }

function toAdminUser(session: AppAuthSession): AdminUser {
  return {
    id: session.userId,
    username: session.username,
    role: UserRole.Admin,
    auth_method: 'password',
    isActive: session.isActive,
    loginTime: session.loginTime,
  }
}

function toBuilderUser(session: AppAuthSession): BuilderUser {
  return {
    id: session.userId,
    username: session.username,
    role: UserRole.Builder,
    auth_method: 'keychain',
    isActive: session.isActive,
    loginTime: session.loginTime,
  }
}

export async function resolveAdminAuth(
  request: Request
): Promise<AdminAuthResult> {
  const session = await getAppAuthSession(request.headers)

  if (!session || session.role !== UserRole.Admin || !session.isActive) {
    return { kind: 'anonymous', redirectTo: ROUTES.LOGIN }
  }

  return { kind: 'active', user: toAdminUser(session) }
}

export async function resolveBuilderAuth(
  request: Request
): Promise<BuilderAuthResult> {
  const session = await getAppAuthSession(request.headers)

  if (!session || session.role !== UserRole.Builder || !session.username) {
    return { kind: 'anonymous', redirectTo: ROUTES.BUILDERS_LOGIN }
  }

  if (!session.userId || !session.isActive) {
    return { kind: 'pending', username: session.username }
  }

  return { kind: 'active', user: toBuilderUser(session) }
}

/** @deprecated Use resolveAdminAuth — kept as a thin alias for callers. */
export async function requireAdminAuth(
  request: Request
): Promise<AdminAuthResult> {
  return resolveAdminAuth(request)
}

/** @deprecated Use resolveBuilderAuth — kept as a thin alias for callers. */
export async function requireBuildersAuth(
  request: Request
): Promise<BuilderAuthResult> {
  return resolveBuilderAuth(request)
}

export async function getAuthenticatedUser(
  context: Pick<APIContext, 'request' | 'redirect'>,
  area: 'admin' | 'builders' = 'admin'
) {
  if (area === 'admin') {
    const result = await resolveAdminAuth(context.request)
    if (result.kind !== 'active') {
      return context.redirect(result.redirectTo)
    }
    return result.user
  }

  const result = await resolveBuilderAuth(context.request)
  if (result.kind === 'anonymous') {
    return context.redirect(result.redirectTo)
  }
  if (result.kind === 'pending') {
    return context.redirect(ROUTES.BUILDERS_DASHBOARD)
  }
  return result.user
}

export function isAdmin(user: AuthenticatedUser): boolean {
  return user.role === UserRole.Admin
}

export function isBuilder(user: AuthenticatedUser): boolean {
  return user.role === UserRole.Builder
}

export function isAdminUser(user: AuthenticatedUser): user is AdminUser {
  return user.role === UserRole.Admin
}

export function isBuilderUser(user: AuthenticatedUser): user is BuilderUser {
  return user.role === UserRole.Builder
}
