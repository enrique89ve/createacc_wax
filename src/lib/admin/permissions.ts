/**
 * Permission utilities for role-based access control
 * Part of the scalable auth architecture
 * Extended to support both UniversalSession and UserWithPermissions
 */

import type {
  UniversalSession,
  Permission,
  SuperAdminPermission,
  ModeratorPermission,
  UserPermission,
} from '@/types/auth'
import type { NewUser } from '@/lib/schemas/users'

export interface UserWithPermissions extends NewUser {
  readonly permissions: readonly Permission[]
  readonly role: 'superadmin' | 'moderator' | 'user'
}

export type SessionLike =
  | UniversalSession
  | UserWithPermissions
  | null
  | undefined

// ===== PERMISSION CHECKING =====

/**
 * Check if user has specific permission
 * Works with both UniversalSession and UserWithPermissions
 */
export function hasPermission(
  user: SessionLike,
  permission: Permission | string
): boolean {
  if (!user) return false

  try {
    // SuperAdmin always has all permissions
    const role = 'role' in user ? user.role : undefined
    if (role === 'superadmin') return true

    // Check permissions array
    const permissions: readonly Permission[] =
      'permissions' in user ? (user.permissions as readonly Permission[]) : []
    const normalizedPermission = String(permission) as Permission
    return permissions.includes(normalizedPermission)
  } catch (error) {
    console.error('Error checking permission:', error)
    return false
  }
}

/**
 * Check if user has ANY of the provided permissions
 */
export function hasAnyPermission(
  user: SessionLike,
  permissions: readonly Permission[]
): boolean {
  if (!user) return false

  const role = 'role' in user ? user.role : undefined
  if (role === 'superadmin') return true

  return permissions.some(permission => hasPermission(user, permission))
}

/**
 * Check if user has ALL of the provided permissions
 */
export function hasAllPermissions(
  user: SessionLike,
  permissions: readonly Permission[]
): boolean {
  if (!user) return false

  const role = 'role' in user ? user.role : undefined
  if (role === 'superadmin') return true

  return permissions.every(permission => hasPermission(user, permission))
}

// ===== ROLE HELPERS =====

/**
 * Check if user is superadmin
 */
export function isSuperAdmin(user: SessionLike): boolean {
  const role = user && 'role' in user ? user.role : undefined
  return role === 'superadmin'
}

/**
 * Check if user is moderator
 */
export function isModerator(user: SessionLike): boolean {
  const role = user && 'role' in user ? user.role : undefined
  return role === 'moderator'
}

/**
 * Check if user is regular user
 */
export function isRegularUser(user: SessionLike): boolean {
  const role = user && 'role' in user ? user.role : undefined
  return role === 'user'
}

/**
 * Check if user uses keychain auth
 */
export function usesKeychain(user: SessionLike): boolean {
  const authMethod =
    user && 'authMethod' in user
      ? user.authMethod
      : user && 'auth_method' in user
        ? user.auth_method
        : undefined
  return authMethod === 'keychain'
}

/**
 * Get user role string
 */
export function getUserRole(
  user: SessionLike
): 'superadmin' | 'moderator' | 'user' | 'anonymous' {
  if (!user) return 'anonymous'
  const role = 'role' in user ? user.role : undefined
  return role || 'anonymous'
}

// ===== PERMISSION SETS =====

/**
 * Default permissions for each role
 */
export const DEFAULT_PERMISSIONS = {
  superadmin: [
    'manage_system',
    'manage_users',
    'manage_tickets',
    'manage_moderators',
    'view_analytics',
  ],
  moderator: ['create_tickets', 'moderate_users', 'view_user_activity'],
  user: ['create_accounts', 'buy_credits', 'view_own_activity'],
} as const

/**
 * Get default permissions for a role
 */
export function getDefaultPermissions(
  role: 'superadmin' | 'moderator' | 'user'
): Permission[] {
  // Returning the default permissions for the specified role
  return [...DEFAULT_PERMISSIONS[role]] as Permission[]
}

// ===== ASTRO HELPERS =====

/**
 * Helper for Astro pages to require specific permission
 * Throws redirect if user doesn't have permission
 */
export function requirePermission(
  user: SessionLike,
  permission: Permission,
  redirectTo: string = '/management/access'
): asserts user is NonNullable<SessionLike> {
  if (!hasPermission(user, permission)) {
    throw new Response(null, {
      status: 302,
      headers: { Location: redirectTo },
    })
  }
}

/**
 * Helper for Astro pages to require authentication
 * Throws redirect if user not authenticated
 */
export function requireAuth(
  user: SessionLike,
  redirectTo: string = '/management/access'
): asserts user is NonNullable<SessionLike> {
  if (!user) {
    throw new Response(null, {
      status: 302,
      headers: { Location: redirectTo },
    })
  }
}

// ===== OPERATION PERMISSIONS =====

/**
 * Permission requirements for common operations
 */
export const OPERATION_PERMISSIONS = {
  // Management Console Access
  ACCESS_CONSOLE: ['manage_system', 'create_tickets'],

  // User Management
  MANAGE_ALL_USERS: ['manage_users'],
  VIEW_USER_LIST: ['manage_users', 'moderate_users'],

  // Ticket Operations
  CREATE_ANY_TICKET: ['manage_tickets', 'create_tickets'],
  DELETE_ANY_TICKET: ['manage_tickets'],
  VIEW_ALL_TICKETS: ['manage_tickets', 'create_tickets'],

  // System Operations
  VIEW_SYSTEM_STATS: ['manage_system', 'view_analytics'],
  MANAGE_SYSTEM_CONFIG: ['manage_system'],

  // Account Creation
  CREATE_HIVE_ACCOUNT: ['create_accounts'],

  // Credits
  PURCHASE_CREDITS: ['buy_credits'],
} as const

/**
 * Check if user can perform a specific operation
 */
export function canPerformOperation(
  user: SessionLike,
  operation: keyof typeof OPERATION_PERMISSIONS
): boolean {
  const requiredPermissions = OPERATION_PERMISSIONS[operation]
  return hasAnyPermission(user, requiredPermissions)
}

/**
 * Assert that user has permission for operation, throw if not
 */
export function assertCanPerformOperation(
  user: SessionLike,
  operation: keyof typeof OPERATION_PERMISSIONS,
  context?: string
): asserts user is NonNullable<SessionLike> {
  if (!canPerformOperation(user, operation)) {
    const contextMsg = context ? ` in ${context}` : ''
    throw new Error(
      `Insufficient permissions for operation: ${operation}${contextMsg}`
    )
  }
}
