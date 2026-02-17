import { db } from '@/lib/database'
import { creditsService } from '@/lib/credits-service'
import { parseTicketRow } from '@/types/database'
import type { DatabaseTicketRow } from '@/types/database'
import {
  ALL_ERROR_CODES,
  BLOCKCHAIN_ERROR_CODES,
  DATABASE_ERROR_CODES,
  VALIDATION_ERROR_CODES,
  type UnifiedErrorCode,
} from '@/consts/unified-errors'

/**
 * Re-exportar códigos del sistema unificado para compatibilidad
 * Elimina duplicaciones y usa el sistema centralizado
 */
export const ERROR_CODES = ALL_ERROR_CODES
export type ErrorCode = UnifiedErrorCode

// Alias específicos para operaciones de tickets (compatibilidad)
export const TICKET_ERROR_CODES = {
  TICKET_NOT_FOUND: VALIDATION_ERROR_CODES.TICKET_NOT_FOUND,
  TICKET_RACE_CONDITION: VALIDATION_ERROR_CODES.TICKET_RACE_CONDITION,
  TICKET_ALREADY_USED: VALIDATION_ERROR_CODES.TICKET_ALREADY_USED,
  ACCOUNT_EXISTS: BLOCKCHAIN_ERROR_CODES.ACCOUNT_ALREADY_EXISTS, // Mapeo semántico correcto
  IDEMPOTENCY_CHECK_FAILED: VALIDATION_ERROR_CODES.IDEMPOTENCY_CHECK_FAILED,
  CHAIN_VERIFICATION_FAILED: BLOCKCHAIN_ERROR_CODES.CHAIN_VERIFICATION_FAILED,
  CHAIN_VERIFICATION_TIMEOUT: BLOCKCHAIN_ERROR_CODES.CHAIN_VERIFICATION_TIMEOUT,
} as const

// Constantes para evitar magic numbers
const TICKET_CODE_MIN = 4
const TICKET_CODE_MAX = 24

function sanitizeTicketCode(raw: string): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const code = raw.trim().toUpperCase()

  // Validar longitud
  if (code.length < TICKET_CODE_MIN || code.length > TICKET_CODE_MAX) {
    return null
  }

  // SEGURIDAD: Solo permitir caracteres alfanuméricos (evita inyección)
  if (!/^[A-Z0-9]+$/.test(code)) {
    return null
  }

  // SEGURIDAD: No permitir solo números
  if (/^\d+$/.test(code)) {
    return null
  }

  return code
}

function sanitizeUsername(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const username = raw.trim().toLowerCase()
  if (!username) return null
  return username
}

// Use centralized database types
export type { DatabaseTicketRow } from '@/types/database'

export interface TicketValidationResult {
  readonly isValid: boolean
  readonly error?: string
  readonly ticket?: DatabaseTicketRow
}

/**
 * Valida un ticket contra la base de datos
 * Verifica que existe y no está usado
 */
export async function validateTicketInDB(
  ticketCode: string
): Promise<TicketValidationResult> {
  try {
    const cleanCode = sanitizeTicketCode(ticketCode)
    if (!cleanCode) {
      return { isValid: false, error: 'Código de ticket inválido' }
    }

    const result = await db.execute({
      sql: `SELECT id, code, description, original_credits, credits, is_active, has_been_used, created_by, created_at, updated_at FROM Tickets WHERE code = ?`,
      args: [cleanCode],
    })

    if (result.rows.length === 0) {
      return { isValid: false, error: 'Ticket no encontrado' }
    }

    const ticket = parseTicketRow(result.rows[0])
    if (!ticket) {
      return { isValid: false, error: 'Formato de ticket inválido' }
    }

    if (!ticket.is_active) {
      return { isValid: false, error: 'Ticket no está activo' }
    }

    // Verificar que el ticket tenga créditos disponibles
    if (ticket.credits <= 0) {
      return { isValid: false, error: 'Ticket sin créditos disponibles' }
    }

    return { isValid: true, ticket }
  } catch (error) {
    return { isValid: false, error: 'Error interno validando ticket' }
  }
}

/**
 * Marca un ticket como usado
 */
export async function markTicketAsUsed(ticketCode: string): Promise<boolean> {
  try {
    const cleanCode = sanitizeTicketCode(ticketCode)
    if (!cleanCode) return false

    // UPDATE reduciendo créditos y refrescando updated_at
    // is_active y has_been_used se actualizan automáticamente
    const updateReturning = await db.execute({
      sql: `UPDATE Tickets
            SET credits = CASE WHEN credits > 0 THEN credits - 1 ELSE 0 END,
                updated_at = CURRENT_TIMESTAMP
            WHERE code = ? AND is_active = TRUE
            RETURNING id, code`,
      args: [cleanCode],
    })

    if (updateReturning.rows.length === 0) {
      return false // ya no tenía créditos o no existía
    }

    const row = updateReturning.rows[0] as { id?: unknown; code?: unknown }
    if (typeof row.id !== 'number' || typeof row.code !== 'string') {
      return false
    }

    // Note: TicketAudit is only for administrative actions, not user usage
    // Usage tracking is done through Accounts table relationship

    return true
  } catch (error) {
    return false
  }
}

// Use centralized type guard from database types

/**
 * Guarda una cuenta creada exitosamente en la tabla Accounts
 */
export async function saveCreatedAccount(
  username: string,
  ticket?: string,
  ticketBy?: string | null
): Promise<boolean> {
  try {
    const cleanUsername = sanitizeUsername(username)
    if (!cleanUsername) return false

    const cleanTicket = ticket ? sanitizeTicketCode(ticket) : null

    await db.execute({
      sql: `INSERT INTO Accounts (username, ticket, ticket_by, creation_date, registered_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      args: [cleanUsername, cleanTicket || 'N/A', ticketBy ?? null],
    })

    return true
  } catch (error) {
    return false
  }
}

/**
 * Verifica si una cuenta ya existe en la base de datos (idempotencia)
 */
export async function accountExistsInDB(username: string): Promise<boolean> {
  try {
    const cleanUsername = sanitizeUsername(username)
    if (!cleanUsername) return false

    const result = await db.execute({
      sql: `SELECT username FROM Accounts WHERE username = ?`,
      args: [cleanUsername],
    })

    return result.rows.length > 0
  } catch (error) {
    return false
  }
}

/**
 * Verifica si un ticket ya está marcado como usado (idempotencia)
 */
export async function isTicketAlreadyUsed(
  ticketCode: string
): Promise<boolean> {
  try {
    const cleanCode = sanitizeTicketCode(ticketCode)
    if (!cleanCode) return false

    const result = await db.execute({
      sql: `SELECT has_been_used FROM Tickets WHERE code = ?`,
      args: [cleanCode],
    })

    if (result.rows.length === 0) return false

    const row = result.rows[0] as { has_been_used?: unknown }
    return Boolean(row.has_been_used)
  } catch (error) {
    return false
  }
}

/**
 * Resultado de validación de idempotencia
 */
export interface IdempotencyCheckResult {
  readonly canProceed: boolean
  readonly accountExists: boolean
  readonly ticketUsed: boolean
  readonly message: string
}

/**
 * Verifica condiciones de idempotencia antes de crear cuenta
 * Optimizado con verificaciones paralelas
 */
export async function checkIdempotency(
  username: string,
  ticketCode?: string
): Promise<IdempotencyCheckResult> {
  try {
    // Ejecutar verificaciones en paralelo para reducir latencia
    const [accountExists, ticketUsed] = await Promise.all([
      accountExistsInDB(username),
      ticketCode ? isTicketAlreadyUsed(ticketCode) : Promise.resolve(false),
    ])

    // Si la cuenta ya existe, es idempotente (éxito)
    if (accountExists) {
      return {
        canProceed: false,
        accountExists: true,
        ticketUsed,
        message: `Account ${username} already exists - operation is idempotent`,
      }
    }

    // Si el ticket ya fue usado, es un error
    if (ticketUsed) {
      return {
        canProceed: false,
        accountExists: false,
        ticketUsed: true,
        message: `Ticket ${ticketCode} has already been used`,
      }
    }

    // Todo bien, se puede proceder
    return {
      canProceed: true,
      accountExists: false,
      ticketUsed: false,
      message: 'Can proceed with account creation',
    }
  } catch (error) {
    return {
      canProceed: false,
      accountExists: false,
      ticketUsed: false,
      message: 'Error checking idempotency',
    }
  }
}

/**
 * Resultado específico de la operación DB con códigos de error tipados
 */
export interface DBOperationResult {
  readonly success: boolean
  readonly error?: string
  readonly errorCode?: ErrorCode
  readonly correlationId?: string
}

/**
 * F2 FIX: Reserve a ticket credit atomically BEFORE on-chain account creation.
 * Uses BEGIN IMMEDIATE TRANSACTION to prevent race conditions.
 * If the on-chain creation fails afterwards, call rollbackTicketReservation().
 */
export async function reserveTicketCredit(
  ticketCode: string,
  correlationId?: string
): Promise<DBOperationResult> {
  const cleanTicketCode = sanitizeTicketCode(ticketCode)
  if (!cleanTicketCode) {
    return {
      success: false,
      error: 'Invalid ticket format',
      errorCode: DATABASE_ERROR_CODES.INVALID_INPUT,
      correlationId,
    }
  }

  try {
    await db.execute('BEGIN IMMEDIATE TRANSACTION')

    try {
      const updateResult = await db.execute({
        sql: `UPDATE Tickets
              SET credits = CASE
                    WHEN credits > 0 THEN credits - 1
                    ELSE 0
                  END,
                  updated_at = CURRENT_TIMESTAMP
              WHERE code = ? AND is_active = TRUE AND credits > 0
              RETURNING id, code, credits as remaining_credits`,
        args: [cleanTicketCode],
      })

      if (updateResult.rows.length === 0) {
        const checkResult = await db.execute({
          sql: `SELECT is_active, credits FROM Tickets WHERE code = ?`,
          args: [cleanTicketCode],
        })

        await db.execute('ROLLBACK')

        if (checkResult.rows.length === 0) {
          return {
            success: false,
            error: 'Ticket does not exist',
            errorCode: VALIDATION_ERROR_CODES.TICKET_NOT_FOUND,
            correlationId,
          }
        }
        return {
          success: false,
          error: 'Ticket has no available credits or is inactive',
          errorCode: VALIDATION_ERROR_CODES.TICKET_RACE_CONDITION,
          correlationId,
        }
      }

      await db.execute('COMMIT')
      return { success: true, correlationId }
    } catch (innerError) {
      await db.execute('ROLLBACK')
      throw innerError
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return {
      success: false,
      error: `Ticket reservation failed: ${errorMessage}`,
      errorCode: DATABASE_ERROR_CODES.INTERNAL_ERROR,
      correlationId,
    }
  }
}

/**
 * F2 FIX: Rollback a ticket reservation if on-chain creation fails.
 * Restores the credit that was previously deducted by reserveTicketCredit().
 */
export async function rollbackTicketReservation(
  ticketCode: string,
  correlationId?: string
): Promise<DBOperationResult> {
  const cleanTicketCode = sanitizeTicketCode(ticketCode)
  if (!cleanTicketCode) {
    return {
      success: false,
      error: 'Invalid ticket format',
      errorCode: DATABASE_ERROR_CODES.INVALID_INPUT,
      correlationId,
    }
  }

  try {
    const result = await db.execute({
      sql: `UPDATE Tickets
            SET credits = credits + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE code = ?
            RETURNING id`,
      args: [cleanTicketCode],
    })

    if (result.rows.length === 0) {
      console.error(
        `[${correlationId}] CRITICAL: Failed to rollback ticket ${cleanTicketCode} - not found`
      )
      return {
        success: false,
        error: 'Ticket not found for rollback',
        errorCode: VALIDATION_ERROR_CODES.TICKET_NOT_FOUND,
        correlationId,
      }
    }

    console.warn(
      `[${correlationId}] Ticket ${obfuscateTicket(ticketCode)} credit rolled back successfully`
    )
    return { success: true, correlationId }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    console.error(
      `[${correlationId}] CRITICAL: Ticket rollback failed: ${errorMessage}`
    )
    return {
      success: false,
      error: `Rollback failed: ${errorMessage}`,
      errorCode: DATABASE_ERROR_CODES.INTERNAL_ERROR,
      correlationId,
    }
  }
}

/**
 * Complete post-creation DB operations after successful on-chain creation.
 * Ticket credit was already reserved by reserveTicketCredit().
 * This function saves the account record and marks builder credits as consumed.
 */
export async function completeAccountCreationInDB(
  username: string,
  ticketCode: string,
  correlationId?: string
): Promise<DBOperationResult> {
  const cleanUsername = sanitizeUsername(username)
  if (!cleanUsername) {
    return {
      success: false,
      error: 'Invalid username format',
      errorCode: DATABASE_ERROR_CODES.INVALID_INPUT,
      correlationId,
    }
  }

  const cleanTicketCode = sanitizeTicketCode(ticketCode)
  if (!cleanTicketCode) {
    return {
      success: false,
      error: 'Invalid ticket format',
      errorCode: DATABASE_ERROR_CODES.INVALID_INPUT,
      correlationId,
    }
  }

  try {
    await db.execute('BEGIN IMMEDIATE TRANSACTION')

    try {
      // 1. Get ticket creator info
      const ticketInfo = await db.execute({
        sql: `SELECT created_by,
              (SELECT username FROM Users WHERE id = created_by) as creator_username
              FROM Tickets WHERE code = ?`,
        args: [cleanTicketCode],
      })

      const creatorUsername = ticketInfo.rows.length > 0
        ? ticketInfo.rows[0].creator_username as string | null
        : null
      const createdBy = ticketInfo.rows.length > 0
        ? ticketInfo.rows[0].created_by as number | null
        : null

      // 2. Save account record
      try {
        await db.execute({
          sql: `INSERT INTO Accounts (username, ticket, ticket_by, creation_date, registered_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          args: [cleanUsername, cleanTicketCode, creatorUsername],
        })
      } catch (accountError) {
        if (
          accountError instanceof Error &&
          accountError.message.includes('UNIQUE')
        ) {
          throw new Error('ACCOUNT_EXISTS')
        }
        throw accountError
      }

      // 3. Mark credits as consumed in the builder balance
      if (createdBy) {
        await creditsService.markCreditsAsConsumed(createdBy, 1, cleanUsername)
      }

      await db.execute('COMMIT')
      return { success: true, correlationId }
    } catch (innerError) {
      await db.execute('ROLLBACK')
      throw innerError
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    if (errorMessage === 'ACCOUNT_EXISTS') {
      return {
        success: false,
        error: 'Account already exists in database',
        errorCode: BLOCKCHAIN_ERROR_CODES.ACCOUNT_ALREADY_EXISTS,
        correlationId,
      }
    }

    return {
      success: false,
      error: `Transaction failed: ${errorMessage}`,
      errorCode: DATABASE_ERROR_CODES.INTERNAL_ERROR,
      correlationId,
    }
  }
}

/**
 * Persist an entry in the ReconciliationQueue when an operation outcome is ambiguous.
 * Called when requiresReconciliation: true is returned to the client.
 */
/**
 * Max length for free-text fields written to ReconciliationQueue.
 * Prevents pathologically long error messages from inflating rows.
 */
const RECONCILIATION_MAX_TEXT_LENGTH = 512

function truncateText(value: string | undefined, maxLength = RECONCILIATION_MAX_TEXT_LENGTH): string | null {
  if (!value) return null
  return value.slice(0, maxLength)
}

export async function enqueueReconciliation(params: {
  correlationId: string
  username: string
  ticketCode: string
  reason: 'ambiguous_chain_error' | 'db_completion_failed'
  errorCategory?: string
  errorMessage?: string
  transactionId?: string
}): Promise<void> {
  try {
    const cleanTicket = sanitizeTicketCode(params.ticketCode)
    const cleanUsername = sanitizeUsername(params.username)

    // Reject insert if both sanitizations fail — never write raw untrusted data
    if (!cleanUsername || !cleanTicket) {
      console.error(
        `[${params.correlationId}] Cannot enqueue reconciliation: sanitization failed (username=${!!cleanUsername}, ticket=${!!cleanTicket})`
      )
      return
    }

    await db.execute({
      sql: `INSERT INTO ReconciliationQueue
            (correlation_id, username, ticket_code, reason, error_category, error_message, transaction_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        params.correlationId.slice(0, RECONCILIATION_MAX_TEXT_LENGTH),
        cleanUsername,
        cleanTicket,
        params.reason,
        truncateText(params.errorCategory),
        truncateText(params.errorMessage),
        truncateText(params.transactionId),
      ],
    })
  } catch (error) {
    // Best-effort: log but don't throw — the response already told the client
    console.error(
      `[${params.correlationId}] Failed to enqueue reconciliation: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * A pending reconciliation entry from the database.
 */
export interface ReconciliationEntry {
  readonly id: number
  readonly correlationId: string
  readonly username: string
  readonly ticketCode: string
  readonly reason: 'ambiguous_chain_error' | 'db_completion_failed'
  readonly errorCategory: string | null
  readonly errorMessage: string | null
  readonly transactionId: string | null
  readonly createdAt: string
}

/**
 * Fetch all unresolved reconciliation entries.
 */
export async function getPendingReconciliations(): Promise<ReconciliationEntry[]> {
  const result = await db.execute(
    `SELECT id, correlation_id, username, ticket_code, reason,
            error_category, error_message, transaction_id, created_at
     FROM ReconciliationQueue
     WHERE resolved = FALSE
     ORDER BY created_at ASC`
  )

  return result.rows.map(row => ({
    id: row.id as number,
    correlationId: row.correlation_id as string,
    username: row.username as string,
    ticketCode: row.ticket_code as string,
    reason: row.reason as ReconciliationEntry['reason'],
    errorCategory: row.error_category as string | null,
    errorMessage: row.error_message as string | null,
    transactionId: row.transaction_id as string | null,
    createdAt: row.created_at as string,
  }))
}

/**
 * Mark a reconciliation entry as resolved.
 */
export async function resolveReconciliationEntry(
  entryId: number,
  resolvedBy: string
): Promise<boolean> {
  const result = await db.execute({
    sql: `UPDATE ReconciliationQueue
          SET resolved = TRUE, resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
          WHERE id = ? AND resolved = FALSE
          RETURNING id`,
    args: [resolvedBy, entryId],
  })
  return result.rows.length > 0
}

/**
 * Ofusca un ticket para logs (muestra primeros 3 y últimos 3 caracteres)
 */
export function obfuscateTicket(ticket: string): string {
  if (!ticket || ticket.length <= 6) {
    return '***'
  }

  const start = ticket.slice(0, 3)
  const end = ticket.slice(-3)
  const middle = '*'.repeat(Math.min(ticket.length - 6, 8)) // Máximo 8 asteriscos

  return `${start}${middle}${end}`
}

// Removed - use centralized type guards from database types
