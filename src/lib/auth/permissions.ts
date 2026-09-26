import { UserRole } from '@/lib/roles'
import { logger } from '@/lib/logger'
import type { AdminSession, BuilderSession } from '@/types/auth'
import { HTTP_STATUS } from '@/consts/constants'
import { DATABASE_ERROR_CODES } from '@/consts/unified-errors'
import { apiError } from '@/utils/errorResponse'

export type AuthenticatedSession = AdminSession | BuilderSession

export const Permission = {
  VIEW_BUILDERS: 'VIEW_BUILDERS',
  ASSIGN_CREDITS: 'ASSIGN_CREDITS',
  ADJUST_CREDITS: 'ADJUST_CREDITS',
  BLOCK_BUILDER: 'BLOCK_BUILDER',
  REACTIVATE_BUILDER: 'REACTIVATE_BUILDER',
  VIEW_ALL_TICKETS: 'VIEW_ALL_TICKETS',
  VIEW_SYSTEM_STATS: 'VIEW_SYSTEM_STATS',
  VIEW_DATABASE_DIAGNOSTICS: 'VIEW_DATABASE_DIAGNOSTICS',
  VIEW_CREDIT_DIAGNOSTICS: 'VIEW_CREDIT_DIAGNOSTICS',
  VIEW_AUDIT_LOGS: 'VIEW_AUDIT_LOGS',
  CREATE_ADMIN_TICKET: 'CREATE_ADMIN_TICKET',
  ACCESS_DASHBOARD: 'ACCESS_DASHBOARD',
  VIEW_OWN_CREDITS: 'VIEW_OWN_CREDITS',
  VIEW_OWN_TICKETS: 'VIEW_OWN_TICKETS',
  CREATE_TICKET: 'CREATE_TICKET',
  UPDATE_OWN_TICKET: 'UPDATE_OWN_TICKET',
  DELETE_OWN_TICKET: 'DELETE_OWN_TICKET',
  VIEW_OWN_ACCOUNTS: 'VIEW_OWN_ACCOUNTS',
  CLAIM_CREDITS: 'CLAIM_CREDITS',
} as const

// The value and type share an identifier through TypeScript's separate namespaces.
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Permission = (typeof Permission)[keyof typeof Permission]

const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  [UserRole.Admin]: [
    Permission.VIEW_BUILDERS,
    Permission.ASSIGN_CREDITS,
    Permission.ADJUST_CREDITS,
    Permission.BLOCK_BUILDER,
    Permission.REACTIVATE_BUILDER,
    Permission.VIEW_ALL_TICKETS,
    Permission.VIEW_SYSTEM_STATS,
    Permission.VIEW_DATABASE_DIAGNOSTICS,
    Permission.VIEW_CREDIT_DIAGNOSTICS,
    Permission.VIEW_AUDIT_LOGS,
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
  return apiError(message, HTTP_STATUS.FORBIDDEN, {
    code: DATABASE_ERROR_CODES.PERMISSION_DENIED,
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
