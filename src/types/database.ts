/**
 * Database types for HolaHive - Nueva arquitectura Admins y Builders
 * Provides type-safe database operations with clean architecture principles
 */

import {
  TICKET_TYPE_LIST,
  type TicketType as TicketTypeLiteral,
} from '@/consts/constants'

// ===== CORE DATABASE ENUMS =====

export const TICKET_TYPES = TICKET_TYPE_LIST
export type TicketType = TicketTypeLiteral

export const AUDIT_ACTIONS = ['create', 'update', 'delete'] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/**
 * @deprecated UserRole solo existe para compatibilidad legacy.
 * En el nuevo sistema, usar tablas separadas: Admins y Builders
 */
export const USER_ROLES = ['admin', 'builder'] as const
export type UserRole = (typeof USER_ROLES)[number]

/**
 * @deprecated CREDIT_STATUS y CREDIT_TYPES eliminados
 * El nuevo sistema Credits usa columnas: pending_amount, available_amount, total_assigned, total_consumed
 * No hay estados ni tipos - solo operaciones registradas en CreditAudit
 */

// ===== DATABASE ROW INTERFACES =====

/**
 * @deprecated DatabaseUserRow - LEGACY TYPE - Solo para compatibilidad
 *
 * ⚠️ La tabla Users NO EXISTE en la base de datos actual.
 *
 * Este tipo se mantiene para:
 * - Type guards en código legacy
 * - Backward compatibility en APIs antiguas
 *
 * NUEVO SISTEMA:
 * - Use `DatabaseAdminRow` para administradores
 * - Use `DatabaseBuilderRow` para builders
 *
 * Campos obsoletos:
 * - `user_credits` → Ahora en tabla Credits
 * - `credit_limit` → Concepto eliminado
 */
export interface DatabaseUserRow {
  readonly id: number
  readonly username: string
  readonly password_hash: string
  readonly role: UserRole
  readonly user_credits: number
  readonly credit_limit: number
  readonly is_active: boolean
  readonly created_at: string
  readonly updated_at: string
  readonly last_login?: string | null
}

/**
 * @deprecated Type alias for backward compatibility
 * Use DatabaseAdminRow or DatabaseBuilderRow instead
 */
export type User = DatabaseUserRow

/**
 * Admins table - Solo 1 admin permitido
 */
export interface DatabaseAdminRow {
  readonly id: number
  readonly username: string
  readonly password_hash: string
  readonly is_active: boolean
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Builders table - Usuarios que crean cuentas vía Keychain
 */
export interface DatabaseBuilderRow {
  readonly id: number
  readonly hive_username: string
  readonly is_active: boolean
  readonly last_claim_at: string | null
  readonly created_at: string
}

/**
 * Credits table - Sistema simplificado (1 fila por builder)
 * pending_amount: Créditos asignados pero no reclamados
 * available_amount: Créditos reclamados y disponibles para crear tickets
 * total_assigned: Total histórico de créditos asignados (solo aumenta)
 * total_consumed: Total histórico de créditos consumidos al crear cuentas (solo aumenta)
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
 * Tickets table - With computed virtual columns
 */
export interface DatabaseTicketRow {
  readonly id: number
  readonly code: string
  readonly type: TicketType
  readonly description: string | null
  readonly original_credits: number
  readonly credits: number
  readonly is_active: boolean // VIRTUAL: credits > 0
  readonly has_been_used: boolean // VIRTUAL: original_credits > credits
  readonly created_by_builder: number | null
  readonly created_by_admin: number | null
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
  readonly performed_by_builder: number | null
  readonly performed_by_admin: number | null
  readonly timestamp: string
}

/**
 * AdminSessions table
 */
export interface DatabaseAdminSessionRow {
  readonly id: number
  readonly admin_id: number
  readonly session_token: string
  readonly expires_at: string
  readonly created_at: string
}

/**
 * BuilderSessions table
 */
export interface DatabaseBuilderSessionRow {
  readonly id: number
  readonly builder_id: number
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
  readonly performed_by_admin: number | null
  readonly timestamp: string
}

// ===== EXTENDED/JOINED QUERY TYPES =====

/**
 * Builder with credits info (joined query)
 */
export interface BuilderWithCredits extends DatabaseBuilderRow {
  readonly pending_amount: number
  readonly available_amount: number
  readonly total_assigned: number
  readonly total_consumed: number
}

/**
 * Ticket with creator info (common join query)
 */
export interface TicketWithCreator extends DatabaseTicketRow {
  readonly creator_type: 'admin' | 'builder' | null
  readonly creator_name: string | null
  readonly created_by_username?: string | null // Alias for compatibility
}

/**
 * Account with ticket info
 */
export interface AccountWithTicketInfo extends DatabaseAccountRow {
  readonly ticket_type?: TicketType
  readonly ticket_description?: string | null
}

// ===== CRUD OPERATION TYPES =====

/**
 * Data required to create a new admin
 */
export interface CreateAdminData {
  readonly username: string
  readonly password_hash: string
  readonly is_active?: boolean
}

/**
 * Data allowed to update for an admin
 */
export interface UpdateAdminData {
  readonly password_hash?: string
  readonly is_active?: boolean
}

/**
 * Data required to create a new builder
 */
export interface CreateBuilderData {
  readonly hive_username: string
  readonly is_active?: boolean
}

/**
 * Data allowed to update for a builder
 */
export interface UpdateBuilderData {
  readonly is_active?: boolean
  readonly last_claim_at?: string
}

/**
 * Data required to create/update credits
 * En el nuevo sistema, credits se manejan con operaciones atómicas,
 * no con inserts/updates directos
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
  readonly type: TicketType
  readonly description?: string | null
  readonly original_credits: number
  readonly credits: number
  readonly created_by_builder?: number | null
  readonly created_by_admin?: number | null
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
  readonly performed_by_builder?: number | null
  readonly performed_by_admin?: number | null
}

/**
 * Data required to create credit audit entry
 */
export interface CreateCreditAuditData {
  readonly builder_id: number
  readonly operation: string
  readonly amount: number
  readonly reason?: string | null
  readonly performed_by_admin?: number | null
}

/**
 * Data required to create admin session
 */
export interface CreateAdminSessionData {
  readonly admin_id: number
  readonly session_token: string
  readonly expires_at: string
}

/**
 * Data required to create builder session
 */
export interface CreateBuilderSessionData {
  readonly builder_id: number
  readonly session_token: string
  readonly expires_at: string
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
 * Type guard for TicketType
 */
export function isTicketType(value: unknown): value is TicketType {
  return typeof value === 'string' && TICKET_TYPES.includes(value as TicketType)
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
 * @deprecated isCreditStatus y isCreditType eliminados
 * El nuevo sistema Credits no usa estados ni tipos
 */

/**
 * @deprecated Type guard for database user row (LEGACY)
 * La tabla Users no existe. Use isDatabaseAdminRow o isDatabaseBuilderRow
 */
export function isDatabaseUserRow(row: unknown): row is DatabaseUserRow {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>

  const isActiveValid =
    typeof r.is_active === 'boolean' || r.is_active === 0 || r.is_active === 1

  return (
    typeof r.id === 'number' &&
    typeof r.username === 'string' &&
    typeof r.password_hash === 'string' &&
    isUserRole(r.role) &&
    typeof r.user_credits === 'number' &&
    typeof r.credit_limit === 'number' &&
    isActiveValid &&
    typeof r.created_at === 'string' &&
    typeof r.updated_at === 'string' &&
    (r.last_login === null ||
      r.last_login === undefined ||
      typeof r.last_login === 'string')
  )
}

/**
 * Type guard for database admin row from libsql result
 */
export function isDatabaseAdminRow(row: unknown): row is DatabaseAdminRow {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>

  const isActiveValid =
    typeof r.is_active === 'boolean' || r.is_active === 0 || r.is_active === 1

  return (
    typeof r.id === 'number' &&
    typeof r.username === 'string' &&
    typeof r.password_hash === 'string' &&
    isActiveValid &&
    typeof r.created_at === 'string' &&
    typeof r.updated_at === 'string'
  )
}

/**
 * Type guard for database builder row from libsql result
 */
export function isDatabaseBuilderRow(row: unknown): row is DatabaseBuilderRow {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>

  const isActiveValid =
    typeof r.is_active === 'boolean' || r.is_active === 0 || r.is_active === 1

  return (
    typeof r.id === 'number' &&
    typeof r.hive_username === 'string' &&
    isActiveValid &&
    (r.last_claim_at === null || typeof r.last_claim_at === 'string') &&
    typeof r.created_at === 'string'
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
    isTicketType(r.type) &&
    (r.description === null || typeof r.description === 'string') &&
    typeof r.original_credits === 'number' &&
    typeof r.credits === 'number' &&
    typeof isActiveBool === 'boolean' &&
    typeof hasBeenUsedBool === 'boolean' &&
    (r.created_by_builder === null ||
      typeof r.created_by_builder === 'number') &&
    (r.created_by_admin === null || typeof r.created_by_admin === 'number') &&
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
    (r.creator_type === 'admin' ||
      r.creator_type === 'builder' ||
      r.creator_type === null) &&
    (r.creator_name === null || typeof r.creator_name === 'string')
  )
}

// ===== UTILITY FUNCTIONS =====

/**
 * @deprecated Safely converts libsql row to typed user row (LEGACY)
 * La tabla Users no existe. Use parseAdminRow o parseBuilderRow
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
 * Safely converts libsql row to typed admin row
 */
export function parseAdminRow(raw: unknown): DatabaseAdminRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  // Convert SQLite boolean values (0/1) to actual booleans
  const isActive =
    r.is_active === 1 || r.is_active === true || r.is_active === '1'

  const converted = {
    ...r,
    is_active: isActive,
  }

  if (!isDatabaseAdminRow(converted)) return null
  return converted
}

/**
 * Safely converts libsql row to typed builder row
 */
export function parseBuilderRow(raw: unknown): DatabaseBuilderRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  // Convert SQLite boolean values (0/1) to actual booleans
  const isActive =
    r.is_active === 1 || r.is_active === true || r.is_active === '1'

  const converted = {
    ...r,
    is_active: isActive,
  }

  if (!isDatabaseBuilderRow(converted)) return null
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
// Re-exportar del sistema unificado para mantener compatibilidad
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

// Fin del archivo - Las interfaces de créditos legacy fueron eliminadas
// Ver nuevos tipos en la sección DATABASE ROW INTERFACES arriba
