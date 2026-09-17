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
  readonly uses: number
  readonly description?: string
}

/** Request para actualizar los usos de un ticket. */
export interface UpdateTicketUsesRequest {
  readonly ticketId: number
  readonly code: string
  readonly delta?: number
  readonly revoked?: boolean
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
  readonly uses: number
}

/** Response al actualizar los usos de un ticket. */
export interface UpdateTicketUsesResponse {
  readonly success: true
  readonly message: string
  readonly oldUses: number
  readonly newUses: number
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
  readonly ticket_total_uses: number
  readonly ticket_remaining_uses: number
}

/**
 * Response de lista de cuentas
 */
export interface AccountsListResponse {
  readonly success: true
  readonly accounts: AccountWithTicketResponse[]
  readonly total: number
}
