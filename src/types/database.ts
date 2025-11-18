/**
 * Database types for HolaHive - Simplified architecture
 * Two roles: admin and builder
 */

import { USER_ROLES, type UserRole } from '@/consts/constants'

// ===== CORE DATABASE ENUMS =====

export const AUDIT_ACTIONS = ['create', 'update', 'delete'] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

// ===== DATABASE ROW INTERFACES =====

/**
 * Users table - Unified table for both admins and builders
 * role: 'admin' | 'builder'
 * password_hash: Required for admins, null for builders (use Keychain)
 */
export interface DatabaseUserRow {
  readonly id: number
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
  readonly builder_id: number
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
  readonly type?: string | null
  readonly description: string | null
  readonly original_credits: number
  readonly credits: number
  readonly is_active: boolean // VIRTUAL: credits > 0
  readonly has_been_used: boolean // VIRTUAL: original_credits > credits
  readonly created_by: number | null
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
  readonly registered_at: string
}

/**
 * TicketAudit table
 */
export interface DatabaseTicketAuditRow {
  readonly id: number
  readonly ticket: string
  readonly action: AuditAction
  readonly performed_by: number | null
  readonly timestamp: string
}

/**
 * UserSessions table (unified for admin and builder)
 */
export interface DatabaseUserSessionRow {
  readonly id: number
  readonly user_id: number
  readonly session_token: string
  readonly expires_at: string
  readonly created_at: string
}

/**
 * CreditAudit table
 */
export interface DatabaseCreditAuditRow {
  readonly id: number
  readonly builder_id: number
  readonly operation: string
  readonly amount: number
  readonly reason: string | null
  readonly performed_by: number | null
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

/**
 * Account with ticket info
 */
export interface AccountWithTicketInfo extends DatabaseAccountRow {
  readonly ticket_description?: string | null
  readonly ticket_original_credits?: number
  readonly ticket_remaining_credits?: number
  readonly ticket_type?: string
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
  readonly builder_id: number
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
  readonly created_by?: number | null
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
}

/**
 * Data required to create ticket audit entry
 */
export interface CreateTicketAuditData {
  readonly ticket: string
  readonly action: AuditAction
  readonly performed_by?: number | null
}

/**
 * Data required to create credit audit entry
 */
export interface CreateCreditAuditData {
  readonly builder_id: number
  readonly operation: string
  readonly amount: number
  readonly reason?: string | null
  readonly performed_by?: number | null
}

/**
 * Data required to create user session
 */
export interface CreateUserSessionData {
  readonly user_id: number
  readonly session_token: string
  readonly expires_at: string
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

// ===== QUERY RESULT TYPES =====

/**
 * Result wrapper for database operations
 */
export interface DatabaseResult<T> {
  readonly success: boolean
  readonly data?: T
  readonly error?: string
  readonly errorCode?: string
}

/**
 * Paginated result for lists
 */
export interface PaginatedResult<T> {
  readonly items: readonly T[]
  readonly totalCount: number
  readonly page: number
  readonly pageSize: number
  readonly hasMore: boolean
}

/**
 * Statistics for admin dashboard
 */
export interface DatabaseStats {
  readonly totalUsers: number
  readonly totalTickets: number
  readonly totalAccounts: number
  readonly activeTickets: number
  readonly usedTickets: number
  readonly todayAccounts: number
}

// ===== TYPE GUARDS =====

/**
 * Type guard for UserRole
 */
export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && USER_ROLES.includes(value as UserRole)
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
 * Type guard for database user row from libsql result
 */
export function isDatabaseUserRow(row: unknown): row is DatabaseUserRow {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>

  const isActiveValid =
    typeof r.is_active === 'boolean' || r.is_active === 0 || r.is_active === 1

  return (
    typeof r.id === 'number' &&
    typeof r.username === 'string' &&
    (r.password_hash === null || typeof r.password_hash === 'string') &&
    isUserRole(r.role) &&
    isActiveValid &&
    (r.last_claim_at === null || typeof r.last_claim_at === 'string') &&
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
    typeof r.builder_id === 'number' &&
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
    (r.created_by === null || typeof r.created_by === 'number') &&
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
