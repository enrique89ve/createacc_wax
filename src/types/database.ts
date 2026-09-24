/**
 * Database types for HolaHive.
 * `"user"` is Admin-only. Builders are not persisted there.
 */

import { UserRole } from '@/lib/roles'

// Re-export UserRole for convenience
export { UserRole }

// ===== CORE DATABASE ENUMS =====

export const AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'uses_adjusted',
  'revoked',
  'restored',
  'archived',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]
export type AuditActorType = 'builder' | 'admin' | 'system'
export type TicketAuditStateValue = string | number | boolean | null

export const NOTIFICATION_TYPES = [
  'pending_credits',
  'account_created',
  'credit_assigned',
  'system',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// ===== DATABASE ROW INTERFACES =====

/**
 * `"user"` table — persisted Admin accounts only.
 */
export interface DatabaseUserRow {
  readonly id: string
  readonly username: string
  readonly password_hash: string | null
  readonly role: typeof UserRole.Admin
  readonly is_active: boolean
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Credits table - Sistema simplificado (1 fila por builder)
 * pending_amount: Créditos asignados pero no reclamados
 * available_amount: Créditos reclamados y disponibles para crear tickets
 * total_issued: Total histórico de créditos asignados (solo aumenta)
 * total_consumed: Total histórico de créditos consumados al crear cuentas (solo aumenta)
 */
export interface DatabaseCreditRow {
  readonly hive_username: string
  readonly pending_amount: number
  readonly available_amount: number
  readonly total_issued: number
  readonly total_consumed: number
  readonly created_at: string
  readonly updated_at: string
}

export const TICKET_KINDS = ['single_use', 'multi_use'] as const
export type TicketKind = (typeof TICKET_KINDS)[number]
export const TICKET_STATUSES = [
  'unused',
  'partially_used',
  'exhausted',
  'revoked',
  'archived',
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]
export const TICKET_FUNDING_SOURCES = ['builder_credits', 'system'] as const
export type TicketFundingSource = (typeof TICKET_FUNDING_SOURCES)[number]

export function deriveTicketKind(totalUses: number): TicketKind {
  return totalUses === 1 ? 'single_use' : 'multi_use'
}

export function deriveTicketStatus(
  totalUses: number,
  remainingUses: number,
  revokedAt: string | null,
  archivedAt: string | null = null
): TicketStatus {
  if (archivedAt !== null) return 'archived'
  if (revokedAt !== null) return 'revoked'
  if (remainingUses === 0) return 'exhausted'
  if (remainingUses === totalUses) return 'unused'
  return 'partially_used'
}

/**
 * Tickets table - Simplified without type field
 */
export interface DatabaseTicketRow {
  readonly id: number
  readonly code: string
  readonly description: string | null
  readonly total_uses: number
  readonly remaining_uses: number
  readonly creator_username: string
  readonly funding_source: TicketFundingSource
  readonly owner_builder_username: string | null
  readonly issuer_admin_id: string | null
  readonly archived_at: string | null
  readonly retired_uses: number
  readonly revoked_at: string | null
  readonly used_uses: number
  readonly kind: TicketKind
  readonly status: TicketStatus
  /** Derived compatibility fields; never persisted. */
  readonly is_active: boolean
  readonly has_been_used: boolean
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
  readonly ticket_id: number
  readonly builder_username: string | null
  readonly registered_at: string
  readonly execution_mode: string
  readonly blockchain_status: string
  readonly transaction_id: string | null
  readonly correlation_id: string | null
  readonly wax_status: string | null
  readonly rc_delegated: number
  readonly rc_status: string
}

/**
 * TicketAudit table
 */
export interface DatabaseTicketAuditRow {
  readonly id: number
  readonly ticket: string
  readonly ticket_id: number
  readonly action: AuditAction
  readonly actor_type: AuditActorType
  readonly actor_id: string
  readonly delta: number | null
  readonly before_uses: number | null
  readonly after_uses: number | null
  readonly before_state: string | null
  readonly after_state: string | null
  readonly operation_reference: string
  readonly performed_by: string | null
  readonly timestamp: string
}

/**
 * CreditAudit table
 */
export interface DatabaseCreditAuditRow {
  readonly id: number
  readonly hive_username: string
  readonly operation: string
  readonly amount: number
  readonly reason: string | null
  readonly performed_by: string | null
  readonly external_reference: string | null
  readonly timestamp: string
}

/**
 * Persisted one-time authorization for a builder credit claim.
 */
export interface DatabaseCreditClaimIntentRow {
  readonly hash: string
  readonly hive_username: string
  readonly amount: number
  readonly created_at: number
  readonly expires_at: number
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
  readonly hive_username: string
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
 * Ticket with creator info (common join query)
 */
export interface TicketWithCreator extends DatabaseTicketRow {
  readonly creator_role: UserRole | null
}

// ===== CRUD OPERATION TYPES =====

/**
 * Data required to create an admin user
 */
export interface CreateUserData {
  readonly username: string
  readonly password_hash?: string | null
  readonly role: typeof UserRole.Admin
  readonly is_active?: boolean
}

/**
 * Data allowed to update for an admin user
 */
export interface UpdateUserData {
  readonly password_hash?: string | null
  readonly is_active?: boolean
}

/**
 * Data required to create/update credits
 */
export interface CreateCreditData {
  readonly hive_username: string
  readonly pending_amount?: number
  readonly available_amount?: number
  readonly total_issued?: number
  readonly total_consumed?: number
}

/**
 * Data allowed to update for credits
 */
export interface UpdateCreditData {
  readonly pending_amount?: number
  readonly available_amount?: number
  readonly total_issued?: number
  readonly total_consumed?: number
}

/**
 * Data required to create a new ticket
 */
interface CreateTicketBase {
  readonly code: string
  readonly description?: string | null
  readonly total_uses: number
  readonly remaining_uses: number
  readonly creator_username: string
  readonly revoked_at?: string | null
}

export type CreateTicketData = CreateTicketBase &
  (
    | {
        readonly funding_source: 'builder_credits'
        readonly owner_builder_username: string
        readonly issuer_admin_id?: null
      }
    | {
        readonly funding_source: 'system'
        readonly owner_builder_username?: null
        readonly issuer_admin_id: string
      }
  )

/**
 * Data allowed to update for a ticket
 */
export interface UpdateTicketData {
  readonly description?: string | null
  readonly total_uses?: number
  readonly remaining_uses?: number
  readonly revoked_at?: string | null
}

/**
 * Data required to create an account
 */
export interface CreateAccountData {
  readonly username: string
  readonly ticket: string
  readonly ticket_id: number
  readonly builder_username: string | null
  readonly execution_mode: string
  readonly blockchain_status: string
  readonly rc_status: string
  readonly rc_delegated: number
  readonly transaction_id?: string | null
  readonly correlation_id?: string | null
  readonly wax_status?: string | null
}

/**
 * Data required to create ticket audit entry
 */
export interface CreateTicketAuditData {
  readonly ticketId: number
  readonly ticket: string
  readonly action: AuditAction
  readonly actorType: AuditActorType
  readonly actorId: string
  readonly delta?: number | null
  readonly beforeUses?: number | null
  readonly afterUses?: number | null
  readonly beforeState?: Readonly<Record<string, TicketAuditStateValue>>
  readonly afterState?: Readonly<Record<string, TicketAuditStateValue>>
  readonly operationReference: string
  readonly performedBy?: string | null
}

/**
 * Data required to create credit audit entry
 */
export interface CreateCreditAuditData {
  readonly hive_username: string
  readonly operation: string
  readonly amount: number
  readonly reason?: string | null
  readonly performed_by?: string | null
  readonly external_reference?: string | null
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
  readonly hive_username: string
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

export function isAuditActorType(value: unknown): value is AuditActorType {
  return value === 'builder' || value === 'admin' || value === 'system'
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
    r.role === UserRole.Admin &&
    isActiveValid &&
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
    typeof r.hive_username === 'string' &&
    typeof r.pending_amount === 'number' &&
    typeof r.available_amount === 'number' &&
    typeof r.total_issued === 'number' &&
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

  return (
    typeof r.id === 'number' &&
    typeof r.code === 'string' &&
    (r.description === null || typeof r.description === 'string') &&
    typeof r.total_uses === 'number' &&
    typeof r.remaining_uses === 'number' &&
    typeof r.creator_username === 'string' &&
    (r.funding_source === 'builder_credits' || r.funding_source === 'system') &&
    (r.owner_builder_username === null ||
      typeof r.owner_builder_username === 'string') &&
    (r.issuer_admin_id === null || typeof r.issuer_admin_id === 'string') &&
    (r.archived_at === null || typeof r.archived_at === 'string') &&
    typeof r.retired_uses === 'number' &&
    (r.revoked_at === null || typeof r.revoked_at === 'string') &&
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
    typeof r.ticket_id === 'number' &&
    Number.isSafeInteger(r.ticket_id) &&
    (r.builder_username === null || typeof r.builder_username === 'string') &&
    typeof r.registered_at === 'string' &&
    typeof r.execution_mode === 'string' &&
    typeof r.blockchain_status === 'string' &&
    (r.transaction_id === null || typeof r.transaction_id === 'string') &&
    (r.correlation_id === null || typeof r.correlation_id === 'string') &&
    (r.wax_status === null || typeof r.wax_status === 'string') &&
    typeof r.rc_delegated === 'number' &&
    Number.isFinite(r.rc_delegated) &&
    typeof r.rc_status === 'string'
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
 * Safely converts libsql row to typed ticket row with derived state
 */
export function parseTicketRow(raw: unknown): DatabaseTicketRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>

  const totalUses = Number(r.total_uses)
  const remainingUses = Number(r.remaining_uses)
  const revokedAt =
    r.revoked_at === null || typeof r.revoked_at === 'string'
      ? (r.revoked_at as string | null)
      : null
  const archivedAt =
    r.archived_at === null || typeof r.archived_at === 'string'
      ? (r.archived_at as string | null)
      : null
  const retiredUses = Number(r.retired_uses)
  if (!Number.isInteger(totalUses) || !Number.isInteger(remainingUses)) {
    return null
  }
  if (
    !Number.isInteger(retiredUses) ||
    totalUses < 1 ||
    remainingUses < 0 ||
    retiredUses < 0 ||
    remainingUses + retiredUses > totalUses
  ) {
    return null
  }

  const converted = {
    ...r,
    total_uses: totalUses,
    remaining_uses: remainingUses,
    retired_uses: retiredUses,
    archived_at: archivedAt,
    revoked_at: revokedAt,
    used_uses: totalUses - remainingUses - retiredUses,
    kind: deriveTicketKind(totalUses),
    status: deriveTicketStatus(totalUses, remainingUses, revokedAt, archivedAt),
    is_active: remainingUses > 0 && revokedAt === null && archivedAt === null,
    has_been_used: totalUses - remainingUses - retiredUses > 0,
  }

  if (!isDatabaseTicketRow(converted)) return null
  return converted
}

/**
 * Safely converts libsql row to typed account row
 */
export function parseAccountRow(raw: unknown): DatabaseAccountRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const converted = {
    ...r,
    ticket_id: Number(r.ticket_id),
    builder_username:
      typeof r.builder_username === 'string' ? r.builder_username : null,
    transaction_id:
      typeof r.transaction_id === 'string' ? r.transaction_id : null,
    correlation_id:
      typeof r.correlation_id === 'string' ? r.correlation_id : null,
    wax_status: typeof r.wax_status === 'string' ? r.wax_status : null,
    rc_delegated: Number(r.rc_delegated),
  }
  if (!isDatabaseAccountRow(converted)) return null
  return converted
}

/**
 * Safely converts libsql row to ticket with creator info
 */
export function parseTicketWithCreatorRow(
  raw: unknown
): TicketWithCreator | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>
  const ticket = parseTicketRow(raw)
  if (!ticket) return null
  if (!(row.creator_role === null || isUserRole(row.creator_role))) return null
  return {
    ...ticket,
    creator_role: row.creator_role as UserRole | null,
  }
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
    typeof r.hive_username === 'string' &&
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
