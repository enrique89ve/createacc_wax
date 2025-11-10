/**
 * @deprecated This file is LEGACY and should not be used.
 * Use types from @/types/database.ts instead.
 *
 * Type-safe definitions for database row structures
 * Elimina la necesidad de usar 'as any' en queries
 */

import type { TicketType } from '@/consts/constants'
import type { UserRole } from '@/types/database'

export interface DatabaseUser {
  readonly id: number
  readonly username: string
  readonly password_hash: string
  readonly role: UserRole
  readonly user_credits: number
  readonly max_credit_limit: number
  readonly is_active: boolean
  readonly created_at: string
  readonly updated_at: string
  readonly last_login?: string | null
}

export interface DatabaseTicket {
  readonly id: number
  readonly code: string
  readonly type: TicketType
  readonly description?: string | null
  readonly original_credits: number
  readonly credits: number
  readonly is_active: boolean
  readonly has_been_used: boolean
  readonly created_at: string
  readonly updated_at: string
  readonly created_by: number
}

export interface DatabaseCreditTransaction {
  readonly id: number
  readonly user_id: number
  readonly ticket_id?: number | null
  readonly amount: number
  readonly transaction_type: 'debit' | 'credit' | 'adjustment'
  readonly description?: string | null
  readonly created_at: string
}

/**
 * Utility types for partial database operations
 */
export type CreateUserData = Omit<
  DatabaseUser,
  'id' | 'created_at' | 'updated_at' | 'last_login'
>
export type UpdateUserData = Partial<
  Omit<DatabaseUser, 'id' | 'created_at' | 'updated_at'>
>

export type CreateTicketData = Omit<
  DatabaseTicket,
  'id' | 'created_at' | 'updated_at'
>
export type UpdateTicketData = Partial<
  Omit<DatabaseTicket, 'id' | 'created_at' | 'updated_at'>
>

/**
 * Type guards for runtime validation
 */
export function isDatabaseUser(row: unknown): row is DatabaseUser {
  return (
    typeof row === 'object' &&
    row !== null &&
    'id' in row &&
    'username' in row &&
    'password_hash' in row &&
    'role' in row
  )
}

export function isDatabaseTicket(row: unknown): row is DatabaseTicket {
  return (
    typeof row === 'object' &&
    row !== null &&
    'id' in row &&
    'code' in row &&
    'type' in row &&
    'credits' in row
  )
}
