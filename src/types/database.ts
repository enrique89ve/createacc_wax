/**
 * Database types for HolaHive - Simplified architecture
 * Two roles: admin and builder
 */

import { UserRole } from '@/lib/roles'

// Re-export UserRole for convenience
export { UserRole }

// ===== CORE DATABASE ENUMS =====

export const AUDIT_ACTIONS = ['create', 'update', 'delete'] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export const NOTIFICATION_TYPES = [
  'pending_credits',
  'account_created',
  'credit_assigned',
  'system',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// ===== DATABASE ROW INTERFACES =====

/**
 * Users table - Unified table for both admins and builders
 * role: 'admin' | 'builder'
 * password_hash: Required for admins, null for builders (use Keychain)
 */
export interface DatabaseUserRow {
  readonly id: string
  readonly username: string
  readonly password_hash: string | null
  readonly role: UserRole
  readonly is_active: boolean
  readonly last_claim_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Credits table - Sistema simplificado (1 fila por builder)
 * pending_amount: Créditos asignados pero no reclamados
 * available_amount: Créditos reclamados y disponibles para crear tickets
 * total_assigned: Total histórico de créditos asignados (solo aumenta)
 * total_consumed: Total histórico de créditos consumados al crear cuentas (solo aumenta)
 */
export interface DatabaseCreditRow {
  readonly id: number
  readonly builder_id: string
  readonly pending_amount: number
  readonly available_amount: number
  readonly total_assigned: number
  readonly total_consumed: number
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Tickets table - Simplified without type field
 */
export interface DatabaseTicketRow {
  readonly id: number
  readonly code: string
  readonly description: string | null
  readonly original_credits: number
  readonly credits: number
  readonly is_active: boolean // VIRTUAL: credits > 0
  readonly has_been_used: boolean // VIRTUAL: original_credits > credits
  readonly created_by: string | null
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Accounts table
 */
export interface DatabaseAccountRow {
  readonly id: number
  readonly username: string
  readonly creation_date: string
  readonly ticket: string
  readonly ticket_by: string | null
  readonly registered_at: string
}

/**
 * TicketAudit table
 */
export interface DatabaseTicketAuditRow {
  readonly id: number
  readonly ticket: string
  readonly action: AuditAction
  readonly performed_by: string | null
  readonly timestamp: string
}

/**
 * CreditAudit table
 */
export interface DatabaseCreditAuditRow {
  readonly id: number
  readonly builder_id: string
  readonly operation: string
  readonly amount: number
  readonly reason: string | null
  readonly performed_by: string | null
  readonly timestamp: string
}

/**
 * LoginAttempts table
 */
export interface DatabaseLoginAttemptRow {
  readonly id: number
  readonly username: string
  readonly role: string | null
  readonly auth_method: 'password' | 'keychain'
  readonly success: boolean
  readonly ip_address: string | null
  readonly user_agent: string | null
  readonly error_message: string | null
  readonly attempted_at: string
}

/**
 * Notifications table
 */
export interface DatabaseNotificationRow {
  readonly id: number
  readonly user_id: string
  readonly type: NotificationType
  readonly title: string
  readonly message: string
  readonly metadata: string | null
  readonly is_read: boolean
  readonly created_at: string
  readonly read_at: string | null
  readonly viewed_at: string | null
}

// ===== EXTENDED/JOINED QUERY TYPES =====

/**
 * User with credits info (joined query for builders)
 */
export interface UserWithCredits extends DatabaseUserRow {
  readonly pending_amount: number
  readonly available_amount: number
  readonly total_assigned: number
  readonly total_consumed: number
}

/**
 * Ticket with creator info (common join query)
 */
export interface TicketWithCreator extends DatabaseTicketRow {
  readonly creator_username: string | null
  readonly creator_role: UserRole | null
}

// ===== CRUD OPERATION TYPES =====

/**
 * Data required to create a new user (admin or builder)
 */
export interface CreateUserData {
  readonly username: string
  readonly password_hash?: string | null
  readonly role: UserRole
  readonly is_active?: boolean
}

/**
 * Data allowed to update for a user
 */
export interface UpdateUserData {
  readonly password_hash?: string | null
  readonly is_active?: boolean
  readonly last_claim_at?: string
}

/**
 * Data required to create/update credits
 */
export interface CreateCreditData {
  readonly builder_id: string
  readonly pending_amount?: number
  readonly available_amount?: number
  readonly total_assigned?: number
  readonly total_consumed?: number
}

/**
 * Data allowed to update for credits
 */
export interface UpdateCreditData {
  readonly pending_amount?: number
  readonly available_amount?: number
  readonly total_assigned?: number
  readonly total_consumed?: number
}

/**
 * Data required to create a new ticket
 */
export interface CreateTicketData {
  readonly code: string
  readonly description?: string | null
  readonly original_credits: number
  readonly credits: number
  readonly created_by?: string | null
}

/**
 * Data allowed to update for a ticket
 */
export interface UpdateTicketData {
  readonly description?: string | null
  readonly original_credits?: number
  readonly credits?: number
}

/**
 * Data required to create an account
 */
export interface CreateAccountData {
  readonly username: string
  readonly ticket: string
  readonly ticket_by?: string | null
}

/**
 * Data required to create ticket audit entry
 */
export interface CreateTicketAuditData {
  readonly ticket: string
  readonly action: AuditAction
  readonly performed_by?: string | null
}

/**
 * Data required to create credit audit entry
 */
export interface CreateCreditAuditData {
  readonly builder_id: string
  readonly operation: string
  readonly amount: number
  readonly reason?: string | null
  readonly performed_by?: string | null
}

/**
 * Data required to create login attempt entry
 */
export interface CreateLoginAttemptData {
  readonly username: string
  readonly role?: string | null
  readonly auth_method: 'password' | 'keychain'
  readonly success: boolean
  readonly ip_address?: string | null
  readonly user_agent?: string | null
  readonly error_message?: string | null
}

/**
 * Data required to create notification entry
 */
export interface CreateNotificationData {
  readonly user_id: string
  readonly type: NotificationType
  readonly title: string
  readonly message: string
  readonly metadata?: string | null
}

/**
 * Data allowed to update for a notification
 */
export interface UpdateNotificationData {
  readonly is_read?: boolean
  readonly read_at?: string | null
}

// ===== TYPE GUARDS =====

/**
 * Type guard for UserRole
 */
export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === 'string' &&
    (value === UserRole.Admin || value === UserRole.Builder)
  )
}

/**
 * Type guard for AuditAction
 */
export function isAuditAction(value: unknown): value is AuditAction {
  return (
    typeof value === 'string' && AUDIT_ACTIONS.includes(value as AuditAction)
  )
}

/**
 * Type guard for NotificationType
 */
export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === 'string' &&
    NOTIFICATION_TYPES.includes(value as NotificationType)
  )
}

/**
 * Type guard for database user row from libsql result
 */
export function isDatabaseUserRow(row: unknown): row is DatabaseUserRow {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>

  const isActiveValid =
    typeof r.is_active === 'boolean' || r.is_active === 0 || r.is_active === 1

  return (
    typeof r.id === 'string' &&
    typeof r.username === 'string' &&
    (r.password_hash === undefined ||
      r.password_hash === null ||
      typeof r.password_hash === 'string') &&
    isUserRole(r.role) &&
    isActiveValid &&
    (r.last_claim_at === undefined ||
      r.last_claim_at === null ||
      typeof r.last_claim_at === 'string') &&
    typeof r.created_at === 'string' &&
    typeof r.updated_at === 'string'
  )
}

/**
 * Type guard for database credit row from libsql result
 */
export function isDatabaseCreditRow(row: unknown): row is DatabaseCreditRow {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>

  return (
    typeof r.id === 'number' &&
    typeof r.builder_id === 'string' &&
    typeof r.pending_amount === 'number' &&
    typeof r.available_amount === 'number' &&
    typeof r.total_assigned === 'number' &&
    typeof r.total_consumed === 'number' &&
    typeof r.created_at === 'string' &&
    typeof r.updated_at === 'string'
  )
}

/**
 * Type guard for database ticket row from libsql result
 */
export function isDatabaseTicketRow(row: unknown): row is DatabaseTicketRow {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>

  // Handle SQLite boolean conversion (can be 0/1 or true/false)
  const isActiveValue = r.is_active
  const hasBeenUsedValue = r.has_been_used
  const isActiveBool =
    isActiveValue === 1 || isActiveValue === true || isActiveValue === '1'
  const hasBeenUsedBool =
    hasBeenUsedValue === 1 ||
    hasBeenUsedValue === true ||
    hasBeenUsedValue === '1'

  return (
    typeof r.id === 'number' &&
    typeof r.code === 'string' &&
    (r.description === null || typeof r.description === 'string') &&
    typeof r.original_credits === 'number' &&
    typeof r.credits === 'number' &&
    typeof isActiveBool === 'boolean' &&
    typeof hasBeenUsedBool === 'boolean' &&
    (r.created_by === null || typeof r.created_by === 'string') &&
    typeof r.created_at === 'string' &&
    typeof r.updated_at === 'string'
  )
}

/**
 * Type guard for database account row from libsql result
 */
export function isDatabaseAccountRow(row: unknown): row is DatabaseAccountRow {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>

  return (
    typeof r.id === 'number' &&
    typeof r.username === 'string' &&
    typeof r.creation_date === 'string' &&
    typeof r.ticket === 'string' &&
    (r.ticket_by === null || typeof r.ticket_by === 'string') &&
    typeof r.registered_at === 'string'
  )
}

/**
 * Type guard for ticket with creator info
 */
export function isTicketWithCreator(row: unknown): row is TicketWithCreator {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>

  return (
    isDatabaseTicketRow(row) &&
    (r.creator_username === null || typeof r.creator_username === 'string') &&
    (r.creator_role === null || isUserRole(r.creator_role))
  )
}

// ===== UTILITY FUNCTIONS =====

/**
 * Safely converts libsql row to typed user row
 */
export function parseUserRow(raw: unknown): DatabaseUserRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  // Convert SQLite boolean values (0/1) to actual booleans
  const isActive =
    r.is_active === 1 || r.is_active === true || r.is_active === '1'

  const converted = {
    ...r,
    is_active: isActive,
  }

  if (!isDatabaseUserRow(converted)) return null
  return converted
}

/**
 * Safely converts libsql row to typed credit row
 */
export function parseCreditRow(raw: unknown): DatabaseCreditRow | null {
  if (!isDatabaseCreditRow(raw)) return null
  return raw
}

/**
 * Safely converts libsql row to typed ticket row with boolean conversion
 */
export function parseTicketRow(raw: unknown): DatabaseTicketRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  // Convert SQLite boolean values
  const isActive =
    r.is_active === 1 || r.is_active === true || r.is_active === '1'
  const hasBeenUsed =
    r.has_been_used === 1 || r.has_been_used === true || r.has_been_used === '1'

  const converted = {
    ...r,
    is_active: isActive,
    has_been_used: hasBeenUsed,
  }

  if (!isDatabaseTicketRow(converted)) return null
  return converted
}

/**
 * Safely converts libsql row to typed account row
 */
export function parseAccountRow(raw: unknown): DatabaseAccountRow | null {
  if (!isDatabaseAccountRow(raw)) return null
  return raw
}

/**
 * Safely converts libsql row to ticket with creator info
 */
export function parseTicketWithCreatorRow(
  raw: unknown
): TicketWithCreator | null {
  if (!isTicketWithCreator(raw)) return null
  return raw
}

/**
 * Type guard for database notification row from libsql result
 */
export function isDatabaseNotificationRow(
  row: unknown
): row is DatabaseNotificationRow {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>

  const isReadValue = r.is_read
  const isReadBool =
    isReadValue === 1 || isReadValue === true || isReadValue === '1'

  return (
    typeof r.id === 'number' &&
    typeof r.user_id === 'string' &&
    isNotificationType(r.type) &&
    typeof r.title === 'string' &&
    typeof r.message === 'string' &&
    (r.metadata === null || typeof r.metadata === 'string') &&
    typeof isReadBool === 'boolean' &&
    typeof r.created_at === 'string' &&
    (r.read_at === null || typeof r.read_at === 'string')
  )
}

/**
 * Safely converts libsql row to typed notification row with boolean conversion
 */
export function parseNotificationRow(
  raw: unknown
): DatabaseNotificationRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const isRead = r.is_read === 1 || r.is_read === true || r.is_read === '1'

  const converted = {
    ...r,
    is_read: isRead,
  }

  if (!isDatabaseNotificationRow(converted)) return null
  return converted
}

// ===== COLLECTION UTILITIES =====

/**
 * Single-pass parse + filter for DB rows.
 * Replaces `.map(parse).filter(x => x !== null)` chains
 * that allocate two intermediate arrays.
 */
export function compactMap<T>(
  rows: readonly unknown[],
  parser: (row: unknown) => T | null
): T[] {
  const result: T[] = []
  for (let i = 0; i < rows.length; i++) {
    const parsed = parser(rows[i])
    if (parsed !== null) result.push(parsed)
  }
  return result
}

// ===== ERROR CODES =====
import {
  DATABASE_ERROR_CODES as UNIFIED_DATABASE_CODES,
  type DatabaseErrorCode as UnifiedDatabaseErrorCode,
} from '@/consts/unified-errors'

export const DATABASE_ERROR_CODES = UNIFIED_DATABASE_CODES
export type DatabaseErrorCode = UnifiedDatabaseErrorCode

/**
 * Standard error for database operations
 */
export interface DatabaseError {
  readonly code: DatabaseErrorCode
  readonly message: string
  readonly details?: Record<string, unknown>
}
