/**
 * 📝 API CONTRACTS
 *
 * Tipos compartidos para requests y responses de todas las APIs.
 * Proporciona type safety end-to-end entre cliente y servidor.
 */

import type { TicketAction } from '@/consts/constants'

// ============================================
// TICKETS - REQUEST TYPES
// ============================================

/**
 * Request para crear un nuevo ticket
 */
export interface CreateTicketRequest {
  readonly code: string
  readonly credits: number
  readonly description?: string
}

/**
 * Request para actualizar créditos de un ticket
 */
export interface UpdateTicketCreditsRequest {
  readonly ticketId: number
  readonly code: string
  readonly delta: number
}

/**
 * Request para gestionar ticket (update/delete)
 */
export interface ManageTicketRequest {
  readonly ticketId: number
  readonly code: string
  readonly action: TicketAction
  readonly delta?: number
}

// ============================================
// TICKETS - RESPONSE TYPES
// ============================================

/**
 * Response de ticket básico
 */
export interface TicketResponse {
  readonly id: number
  readonly code: string
  readonly description: string | null
  readonly original_credits: number
  readonly credits: number
  readonly is_active: boolean
  readonly has_been_used: boolean
  readonly created_at: string
  readonly updated_at: string
}

/**
 * Response de ticket con información del creador
 */
export interface TicketWithCreatorResponse extends TicketResponse {
  readonly creator_username: string | null
  readonly creator_role: string | null
}

/**
 * Response al crear un ticket
 */
export interface CreateTicketResponse {
  readonly success: true
  readonly ticketId: number
  readonly code: string
  readonly credits: number
}

/**
 * Response al actualizar créditos de un ticket
 */
export interface UpdateTicketCreditsResponse {
  readonly success: true
  readonly message: string
  readonly oldCredits: number
  readonly newCredits: number
}

/**
 * Response al eliminar un ticket
 */
export interface DeleteTicketResponse {
  readonly success: true
  readonly message: string
  readonly refundedCredits: number
}

/**
 * Response al verificar disponibilidad de código
 */
export interface CheckTicketCodeResponse {
  readonly available: boolean
  readonly message: string
  readonly error?: string
}

// ============================================
// CREDITS - REQUEST TYPES
// ============================================

/**
 * Request para reclamar créditos (verify)
 */
export interface ClaimCreditsVerifyRequest {
  readonly transactionId: string
  readonly hash: string
}

/**
 * Query params para balance
 */
export interface CreditsBalanceQuery {
  readonly username?: string
  readonly detailed?: boolean
}

// ============================================
// CREDITS - RESPONSE TYPES
// ============================================

/**
 * Response de balance de créditos (simple)
 */
export interface CreditsBalanceResponse {
  readonly success: true
  readonly balance: {
    readonly builder_id: number
    readonly hive_username: string
    readonly claimed_credits: number
    readonly credits_in_tickets: number
    readonly available_credits: number
    readonly is_consistent: boolean
  }
  readonly warning: string | null
}

/**
 * Response de balance detallado
 */
export interface DetailedCreditsBalanceResponse {
  readonly success: true
  readonly balance: {
    readonly builder_id: number
    readonly hive_username: string
    readonly totals: {
      readonly total_claimed: number
      readonly total_in_tickets: number
      readonly total_available: number
    }
    readonly breakdown: {
      readonly active_tickets_count: number
      readonly inactive_tickets_count: number
      readonly tickets_never_used: number
    }
    readonly discrepancy: {
      readonly has_discrepancy: boolean
      readonly expected_available: number
      readonly actual_available: number
      readonly difference: number
    }
  }
  readonly warning: string | null
}

// ============================================
// ACCOUNTS - RESPONSE TYPES
// ============================================

/**
 * Account creada con información del ticket
 */
export interface AccountWithTicketResponse {
  readonly id: number
  readonly username: string
  readonly ticket: string
  readonly creation_date: string
  readonly registered_at: string
  readonly ticket_description: string | null
  readonly ticket_original_credits: number
  readonly ticket_remaining_credits: number
}

/**
 * Response de lista de cuentas
 */
export interface AccountsListResponse {
  readonly success: true
  readonly accounts: AccountWithTicketResponse[]
  readonly total: number
}

// ============================================
// ERROR RESPONSES
// ============================================

/**
 * Response genérica de error
 */
export interface ErrorResponse {
  readonly success: false
  readonly error: string
  readonly details?: string
  readonly errorCode?: string
}

// ============================================
// TYPE GUARDS
// ============================================

/**
 * Type guard para verificar si es un error response
 */
export function isErrorResponse(response: unknown): response is ErrorResponse {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    response.success === false &&
    'error' in response
  )
}

/**
 * Type guard para verificar si es un success response
 */
export function isSuccessResponse<T extends { success: true }>(
  response: unknown
): response is T {
  return (
    typeof response === 'object' &&
    response !== null &&
    'success' in response &&
    response.success === true
  )
}
