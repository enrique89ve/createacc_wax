/**
 * 📝 API CONTRACTS
 *
 * Tipos compartidos para requests y responses de todas las APIs.
 * Proporciona type safety end-to-end entre cliente y servidor.
 */

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

// ============================================
// TICKETS - RESPONSE TYPES
// ============================================

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
