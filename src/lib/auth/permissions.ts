import { UserRole } from '@/lib/roles'
import { logger } from '@/lib/logger'
import type { AdminSession, BuilderSession } from '@/types/auth'

export type AuthenticatedSession = AdminSession | BuilderSession

export const Permission = {
  MANAGE_CREDITS: 'MANAGE_CREDITS',
  ASSIGN_CREDITS: 'MANAGE_CREDITS',
  VIEW_ALL_TICKETS: 'VIEW_ALL_TICKETS',
  VIEW_SYSTEM_STATS: 'VIEW_SYSTEM_STATS',
  ADMIN_ADJUSTMENTS: 'ADMIN_ADJUSTMENTS',
  CREATE_ADMIN_TICKET: 'CREATE_ADMIN_TICKET',
  MANAGE_ALL_CREDITS: 'ADMIN_ADJUSTMENTS',
  ACCESS_DASHBOARD: 'ACCESS_DASHBOARD',
  VIEW_OWN_CREDITS: 'VIEW_OWN_CREDITS',
  VIEW_OWN_TICKETS: 'VIEW_OWN_TICKETS',
  CREATE_TICKET: 'CREATE_TICKET',
  UPDATE_OWN_TICKET: 'UPDATE_OWN_TICKET',
  DELETE_OWN_TICKET: 'DELETE_OWN_TICKET',
  VIEW_OWN_ACCOUNTS: 'VIEW_OWN_ACCOUNTS',
  CLAIM_CREDITS: 'CLAIM_CREDITS',
} as const

export type Permission = (typeof Permission)[keyof typeof Permission]

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  [UserRole.Admin]: [
    Permission.MANAGE_CREDITS,
    Permission.VIEW_ALL_TICKETS,
    Permission.VIEW_SYSTEM_STATS,
    Permission.ADMIN_ADJUSTMENTS,
    Permission.CREATE_ADMIN_TICKET,
  ],
  [UserRole.Builder]: [
    Permission.ACCESS_DASHBOARD,
    Permission.VIEW_OWN_CREDITS,
    Permission.VIEW_OWN_TICKETS,
    Permission.CREATE_TICKET,
    Permission.UPDATE_OWN_TICKET,
    Permission.DELETE_OWN_TICKET,
    Permission.VIEW_OWN_ACCOUNTS,
    Permission.CLAIM_CREDITS,
  ],
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

export function canPerform(
  session: AuthenticatedSession | null | undefined,
  permission: Permission
): boolean {
  if (!session) return false
  return hasPermission(session.role, permission)
}

export function assertCanPerform(
  session: AuthenticatedSession | null | undefined,
  permission: Permission,
  context?: string
): asserts session is AuthenticatedSession {
  if (!canPerform(session, permission)) {
    const role = session?.role ?? 'anonymous'
    const contextMsg = context ? ` [${context}]` : ''
    logger.warn(`[RBAC] Denied: ${role} → ${permission}${contextMsg}`)
    throw new Error(
      `Unauthorized: ${role} cannot perform ${permission}${contextMsg}`
    )
  }
}

export function unauthorizedResponse(message = 'No autorizado'): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function isAdminSession(
  session: AuthenticatedSession | null | undefined
): session is AdminSession {
  return session?.role === UserRole.Admin
}

export function isBuilderSession(
  session: AuthenticatedSession | null | undefined
): session is BuilderSession {
  return session?.role === UserRole.Builder
}
