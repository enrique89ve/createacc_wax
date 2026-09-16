import { db } from '@/lib/database'
import { logger } from '@/lib/logger'
import { creditsService } from '@/lib/credits-service'
import { parseTicketRow } from '@/types/database'
import type { DatabaseTicketRow } from '@/types/database'
import {
  BLOCKCHAIN_STATUS,
  HIVE_TX_MODE_VALUES,
  RC_STATUS,
  WAX_STATUS,
  type BlockchainStatus,
} from '@/consts/hive-execution'
import {
  parseBlockchainStatus,
  parseExecutionMode,
  type PersistedAccountCreation,
} from '@/lib/account-status'
import { isSimulationMode } from '@/lib/hive-execution-mode'
import {
  waxPipelinePassed,
  type HiveTransactionResult,
} from '@/types/hive-transaction'
import {
  getCreationAttempt,
  insertReservedAttempt,
  markAttemptCompleted,
  markAttemptRolledBack,
  waxStatusFromAttempt,
  type CreationAttemptKeys,
} from '@/lib/creation-attempts'
import {
  ALL_ERROR_CODES,
  BLOCKCHAIN_ERROR_CODES,
  DATABASE_ERROR_CODES,
  VALIDATION_ERROR_CODES,
  type UnifiedErrorCode,
} from '@/consts/unified-errors'
import {
  RECONCILIATION_STATUS,
  type ActionableReconciliationStatus,
} from '@/consts/constants'

/**
 * Re-export unified system codes for compatibility
 * Eliminates duplication and uses centralized system
 */
export const ERROR_CODES = ALL_ERROR_CODES
export type ErrorCode = UnifiedErrorCode

// Specific aliases for ticket operations (compatibility)
export const TICKET_ERROR_CODES = {
  TICKET_NOT_FOUND: VALIDATION_ERROR_CODES.TICKET_NOT_FOUND,
  TICKET_RACE_CONDITION: VALIDATION_ERROR_CODES.TICKET_RACE_CONDITION,
  TICKET_ALREADY_USED: VALIDATION_ERROR_CODES.TICKET_ALREADY_USED,
  ACCOUNT_EXISTS: BLOCKCHAIN_ERROR_CODES.ACCOUNT_ALREADY_EXISTS, // Correct semantic mapping
  IDEMPOTENCY_CHECK_FAILED: VALIDATION_ERROR_CODES.IDEMPOTENCY_CHECK_FAILED,
  CHAIN_VERIFICATION_FAILED: BLOCKCHAIN_ERROR_CODES.CHAIN_VERIFICATION_FAILED,
  CHAIN_VERIFICATION_TIMEOUT: BLOCKCHAIN_ERROR_CODES.CHAIN_VERIFICATION_TIMEOUT,
} as const

// Constants to avoid magic numbers
const TICKET_CODE_MIN = 10
const TICKET_CODE_MAX = 24

function sanitizeTicketCode(raw: string): string | null {
  if (typeof raw !== 'string') {
    return null
  }

  const code = raw.trim().toUpperCase()

  // Validate length
  if (code.length < TICKET_CODE_MIN || code.length > TICKET_CODE_MAX) {
    return null
  }

  // SECURITY: Only allow alphanumeric characters (prevents injection)
  if (!/^[A-Z0-9]+$/.test(code)) {
    return null
  }

  // SECURITY: Do not allow only numbers
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
 * Validates a ticket against the database
 * Verifies that it exists and is not used
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

    // Verify that the ticket has available credits
    if (ticket.credits <= 0) {
      return { isValid: false, error: 'Ticket sin créditos disponibles' }
    }

    return { isValid: true, ticket }
  } catch (error) {
    return { isValid: false, error: 'Error interno validando ticket' }
  }
}

/**
 * Marks a ticket as used
 */
export async function markTicketAsUsed(ticketCode: string): Promise<boolean> {
  try {
    const cleanCode = sanitizeTicketCode(ticketCode)
    if (!cleanCode) return false

    // UPDATE reducing credits and refreshing updated_at
    // is_active and has_been_used are updated automatically
    const updateReturning = await db.execute({
      sql: `UPDATE Tickets
            SET credits = CASE WHEN credits > 0 THEN credits - 1 ELSE 0 END,
                updated_at = CURRENT_TIMESTAMP
            WHERE code = ? AND is_active = TRUE
            RETURNING id, code`,
      args: [cleanCode],
    })

    if (updateReturning.rows.length === 0) {
      return false // no longer had credits or did not exist
    }

    const row = updateReturning.rows[0] as { id?: unknown; code?: unknown }
    if (typeof row.id !== 'number' || typeof row.code !== 'string') {
      return false
    }

    // Note: TicketAudit is only for administrative actions, not user usage
    // Usage tracking is done through Accounts table relationship

    return true
  } catch (error) {
    logger.error('[markTicketAsUsed] Failed to mark ticket as used:', error)
    return false
  }
}

// Use centralized type guard from database types

/**
 * Verifies if an account already exists in the database (idempotency)
 */
export async function accountExistsInDB(username: string): Promise<boolean> {
  const existing = await getAccountCreationState(username)
  return existing !== null
}

export interface ReserveTicketCreditInput {
  readonly ticketCode: string
  readonly correlationId: string
  readonly username: string
  readonly keys: CreationAttemptKeys
}

export async function getAccountCreationState(
  username: string
): Promise<PersistedAccountCreation | null> {
  try {
    const cleanUsername = sanitizeUsername(username)
    if (!cleanUsername) return null

    const result = await db.execute({
      sql: `SELECT username, execution_mode, blockchain_status, transaction_id, wax_status
            FROM Accounts WHERE username = ?`,
      args: [cleanUsername],
    })

    if (result.rows.length === 0) return null
    const row = result.rows[0]
    return {
      username: String(row.username),
      executionMode: parseExecutionMode(row.execution_mode),
      blockchainStatus: parseBlockchainStatus(row.blockchain_status),
      transactionId: typeof row.transaction_id === 'string' ? row.transaction_id : null,
      waxStatus: typeof row.wax_status === 'string' ? row.wax_status : null,
    }
  } catch (error) {
    logger.error('[getAccountCreationState] Failed to load account:', error)
    return null
  }
}

export async function updateAccountBlockchainStatus(
  username: string,
  status: BlockchainStatus
): Promise<boolean> {
  try {
    const cleanUsername = sanitizeUsername(username)
    if (!cleanUsername) return false

    const result = await db.execute({
      sql: `UPDATE Accounts SET blockchain_status = ? WHERE username = ? RETURNING username`,
      args: [status, cleanUsername],
    })
    return result.rows.length > 0
  } catch (error) {
    logger.error('[updateAccountBlockchainStatus] Failed to update status:', error)
    return false
  }
}

/**
 * Verifies if a ticket is already marked as used (idempotency)
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
    logger.error('[isTicketAlreadyUsed] Failed to check ticket status:', error)
    return false
  }
}

/**
 * Idempotency validation result
 */
export interface IdempotencyCheckResult {
  readonly canProceed: boolean
  readonly accountExists: boolean
  readonly ticketUsed: boolean
  readonly message: string
}

/**
 * Verifies idempotency conditions before creating account
 * Optimized with parallel checks
 */
export async function checkIdempotency(
  username: string,
  ticketCode?: string
): Promise<IdempotencyCheckResult> {
  try {
    // Run checks in parallel to reduce latency
    const [accountExists, ticketUsed] = await Promise.all([
      accountExistsInDB(username),
      ticketCode ? isTicketAlreadyUsed(ticketCode) : Promise.resolve(false),
    ])

    // If the account already exists, it is idempotent (success)
    if (accountExists) {
      return {
        canProceed: false,
        accountExists: true,
        ticketUsed,
        message: `Account ${username} already exists - operation is idempotent`,
      }
    }

    // If the ticket has already been used, it is an error
    if (ticketUsed) {
      return {
        canProceed: false,
        accountExists: false,
        ticketUsed: true,
        message: `Ticket ${ticketCode} has already been used`,
      }
    }

    // All good, can proceed
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
 * Specific result of the DB operation with typed error codes
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
  input: ReserveTicketCreditInput
): Promise<DBOperationResult> {
  const correlationId = input.correlationId
  const cleanTicketCode = sanitizeTicketCode(input.ticketCode)
  const cleanUsername = sanitizeUsername(input.username)
  if (!cleanTicketCode) {
    return {
      success: false,
      error: 'Invalid ticket format',
      errorCode: DATABASE_ERROR_CODES.INVALID_INPUT,
      correlationId,
    }
  }
  if (!cleanUsername) {
    return {
      success: false,
      error: 'Invalid username format',
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

      await insertReservedAttempt({
        correlationId,
        username: cleanUsername,
        ticket: cleanTicketCode,
        keys: input.keys,
      })

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
  correlationId: string
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
      const marked = await markAttemptRolledBack(correlationId)
      if (!marked) {
        await db.execute('ROLLBACK')
        logger.warn(
          `[${correlationId}] Rollback skipped: attempt is not open`
        )
        return { success: true, correlationId }
      }

      const result = await db.execute({
        sql: `UPDATE Tickets
              SET credits = credits + 1,
                  updated_at = CURRENT_TIMESTAMP
              WHERE code = ?
              RETURNING id`,
        args: [cleanTicketCode],
      })

      if (result.rows.length === 0) {
        await db.execute('ROLLBACK')
        logger.error(
          `[${correlationId}] CRITICAL: Failed to rollback ticket ${cleanTicketCode} - not found`
        )
        return {
          success: false,
          error: 'Ticket not found for rollback',
          errorCode: VALIDATION_ERROR_CODES.TICKET_NOT_FOUND,
          correlationId,
        }
      }

      await db.execute('COMMIT')
      logger.warn(
        `[${correlationId}] Ticket ${obfuscateTicket(ticketCode)} credit rolled back for this attempt`
      )
      return { success: true, correlationId }
    } catch (innerError) {
      await db.execute('ROLLBACK')
      throw innerError
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error(
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
export function blockchainStatusFromTransaction(
  transactionResult: HiveTransactionResult
): BlockchainStatus {
  if (transactionResult.mode === HIVE_TX_MODE_VALUES.SIMULATE) {
    return BLOCKCHAIN_STATUS.SIMULATED
  }
  if (transactionResult.broadcasted) {
    return BLOCKCHAIN_STATUS.BROADCASTED
  }
  return BLOCKCHAIN_STATUS.FAILED
}

function accountRowFromTransaction(
  transactionResult: HiveTransactionResult
): {
  executionMode: string
  blockchainStatus: string
  transactionId: string | null
  waxStatus: string | null
} {
  return {
    executionMode: transactionResult.mode,
    blockchainStatus: blockchainStatusFromTransaction(transactionResult),
    transactionId: transactionResult.id,
    waxStatus: waxPipelinePassed(transactionResult.wax)
      ? WAX_STATUS.PASSED
      : WAX_STATUS.FAILED,
  }
}

export interface CompleteAccountOptions {
  readonly hiveMatched?: boolean
}

function withHiveMatchedStatus(
  row: {
    executionMode: string
    blockchainStatus: string
    transactionId: string | null
    waxStatus: string | null
  },
  hiveMatched: boolean | undefined
) {
  if (!hiveMatched) return row
  return { ...row, blockchainStatus: BLOCKCHAIN_STATUS.CONFIRMED }
}

async function accountRowForCompletion(
  transactionResult: HiveTransactionResult | undefined,
  correlationId: string | undefined,
  options?: CompleteAccountOptions
): Promise<{
  executionMode: string
  blockchainStatus: string
  transactionId: string | null
  waxStatus: string | null
}> {
  const hiveMatched = options?.hiveMatched
  if (transactionResult) {
    return withHiveMatchedStatus(accountRowFromTransaction(transactionResult), hiveMatched)
  }

  if (!correlationId) {
    return withHiveMatchedStatus(
      {
        executionMode: HIVE_TX_MODE_VALUES.BROADCAST,
        blockchainStatus: BLOCKCHAIN_STATUS.CONFIRMED,
        transactionId: null,
        waxStatus: null,
      },
      hiveMatched
    )
  }

  const attempt = await getCreationAttempt(correlationId)
  if (!attempt || !attempt.transactionId) {
    return withHiveMatchedStatus(
      {
        executionMode: attempt?.executionMode ?? HIVE_TX_MODE_VALUES.BROADCAST,
        blockchainStatus: BLOCKCHAIN_STATUS.CONFIRMED,
        transactionId: null,
        waxStatus: null,
      },
      hiveMatched
    )
  }

  const reconstructed: HiveTransactionResult = {
    id: attempt.transactionId,
    mode: attempt.executionMode,
    broadcasted: attempt.broadcasted,
    wax: attempt.wax,
    requiredAuthorities: {},
    signaturePublicKeys: [],
  }
  return withHiveMatchedStatus(
    {
      ...accountRowFromTransaction(reconstructed),
      waxStatus: waxStatusFromAttempt(attempt),
    },
    hiveMatched
  )
}

export async function completeAccountCreationInDB(
  username: string,
  ticketCode: string,
  correlationId?: string,
  transactionResult?: HiveTransactionResult,
  options?: CompleteAccountOptions
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
              (SELECT username FROM "user" WHERE id = created_by) as creator_username
              FROM Tickets WHERE code = ?`,
        args: [cleanTicketCode],
      })

      const creatorUsername = ticketInfo.rows.length > 0
        ? ticketInfo.rows[0].creator_username as string | null
        : null
      const createdBy = ticketInfo.rows.length > 0
        ? (ticketInfo.rows[0].created_by as string | null)
        : null

      const accountMeta = await accountRowForCompletion(
        transactionResult,
        correlationId,
        options
      )

      // 2. Save account record
      try {
        await db.execute({
          sql: `INSERT INTO Accounts (
                  username, ticket, ticket_by, creation_date, registered_at,
                  execution_mode, blockchain_status, transaction_id, correlation_id, wax_status,
                  rc_status, rc_delegated
                )
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            cleanUsername,
            cleanTicketCode,
            creatorUsername,
            accountMeta.executionMode,
            accountMeta.blockchainStatus,
            accountMeta.transactionId,
            correlationId ?? null,
            accountMeta.waxStatus,
            RC_STATUS.PENDING,
            0,
          ],
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

      if (correlationId) {
        await markAttemptCompleted(correlationId)
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
  if (isSimulationMode()) {
    logger.warn(
      `[${params.correlationId}] Reconciliation skipped in simulate mode for ${params.username}`
    )
    return
  }

  try {
    const cleanTicket = sanitizeTicketCode(params.ticketCode)
    const cleanUsername = sanitizeUsername(params.username)

    // Reject insert if both sanitizations fail — never write raw untrusted data
    if (!cleanUsername || !cleanTicket) {
      logger.error(
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
    logger.error(
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
  readonly status: ActionableReconciliationStatus
  readonly attemptCount: number
}

/**
 * Fetch all actionable reconciliation entries (pending or failed).
 */
export async function getPendingReconciliations(): Promise<ReconciliationEntry[]> {
  const result = await db.execute({
    sql: `SELECT id, correlation_id, username, ticket_code, reason,
                  error_category, error_message, transaction_id, created_at,
                  status, attempt_count
           FROM ReconciliationQueue
           WHERE status IN (?, ?)
           ORDER BY created_at ASC`,
    args: [
      RECONCILIATION_STATUS.PENDING,
      RECONCILIATION_STATUS.FAILED,
    ],
  })

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
    status: (row.status as ActionableReconciliationStatus) || RECONCILIATION_STATUS.PENDING,
    attemptCount: (row.attempt_count as number) || 0,
  }))
}

/**
 * @deprecated Broken after status-enum migration — always returns false
 * unless the entry is already in 'processing' state (requires prior claim).
 * Use claimReconciliationEntry + markReconciliationResolved instead.
 */
export async function resolveReconciliationEntry(
  entryId: number,
  resolvedBy: string
): Promise<boolean> {
  return markReconciliationResolved(entryId, resolvedBy)
}

/**
 * Atomically claim a reconciliation entry for processing.
 * Only one worker wins the claim (pending/failed → processing).
 * Increments attempt_count and records processing_since timestamp.
 */
export async function claimReconciliationEntry(
  entryId: number,
  claimedBy: string
): Promise<boolean> {
  const result = await db.execute({
    sql: `UPDATE ReconciliationQueue
          SET status = ?,
              attempt_count = attempt_count + 1,
              processing_since = CURRENT_TIMESTAMP,
              resolved_by = ?
          WHERE id = ? AND status IN (?, ?)
          RETURNING id`,
    args: [
      RECONCILIATION_STATUS.PROCESSING,
      claimedBy,
      entryId,
      RECONCILIATION_STATUS.PENDING,
      RECONCILIATION_STATUS.FAILED,
    ],
  })
  return result.rows.length > 0
}

/**
 * Mark a claimed entry as resolved after successful mutation.
 * Sets both status='resolved' and resolved=TRUE for backward compatibility.
 */
export async function markReconciliationResolved(
  entryId: number,
  resolvedBy: string
): Promise<boolean> {
  const result = await db.execute({
    sql: `UPDATE ReconciliationQueue
          SET status = ?,
              resolved = TRUE,
              resolved_at = CURRENT_TIMESTAMP,
              resolved_by = ?,
              last_error = NULL,
              processing_since = NULL
          WHERE id = ? AND status = ?
          RETURNING id`,
    args: [
      RECONCILIATION_STATUS.RESOLVED,
      resolvedBy,
      entryId,
      RECONCILIATION_STATUS.PROCESSING,
    ],
  })
  return result.rows.length > 0
}

/**
 * Mark a claimed entry as failed after mutation error.
 * The entry becomes retryable in the next reconciliation cycle.
 */
export async function markReconciliationFailed(
  entryId: number,
  errorMessage: string
): Promise<boolean> {
  const result = await db.execute({
    sql: `UPDATE ReconciliationQueue
          SET status = ?,
              last_error = ?,
              processing_since = NULL
          WHERE id = ? AND status = ?
          RETURNING id`,
    args: [
      RECONCILIATION_STATUS.FAILED,
      errorMessage.slice(0, 512),
      entryId,
      RECONCILIATION_STATUS.PROCESSING,
    ],
  })
  return result.rows.length > 0
}

/**
 * Mark a claimed entry as abandoned after exceeding retry budget.
 * Terminal state: removed from actionable queue and requires manual review.
 */
export async function markReconciliationAbandoned(
  entryId: number,
  errorMessage: string
): Promise<boolean> {
  const result = await db.execute({
    sql: `UPDATE ReconciliationQueue
          SET status = ?,
              resolved = TRUE,
              resolved_at = CURRENT_TIMESTAMP,
              last_error = ?,
              processing_since = NULL
          WHERE id = ? AND status = ?
          RETURNING id`,
    args: [
      RECONCILIATION_STATUS.ABANDONED,
      errorMessage.slice(0, 512),
      entryId,
      RECONCILIATION_STATUS.PROCESSING,
    ],
  })
  return result.rows.length > 0
}

/**
 * Reset entries stuck in 'processing' for longer than timeoutMs.
 * Called at the start of each reconciliation cycle to recover from
 * worker crashes or hangs.
 */
export async function resetStuckProcessingEntries(
  timeoutMs: number
): Promise<number> {
  const timeoutSeconds = Math.floor(timeoutMs / 1000)
  const result = await db.execute({
    sql: `UPDATE ReconciliationQueue
          SET status = ?,
              last_error = 'Stuck in processing (timeout)',
              processing_since = NULL
          WHERE status = ?
            AND processing_since IS NOT NULL
            AND datetime(processing_since, '+' || ? || ' seconds') <= datetime('now')
          RETURNING id`,
    args: [
      RECONCILIATION_STATUS.FAILED,
      RECONCILIATION_STATUS.PROCESSING,
      timeoutSeconds,
    ],
  })
  return result.rows.length
}

/**
 * Obfuscates a ticket for logs (shows first 3 and last 3 characters)
 */
export function obfuscateTicket(ticket: string): string {
  if (!ticket || ticket.length <= 6) {
    return '***'
  }

  const start = ticket.slice(0, 3)
  const end = ticket.slice(-3)
  const middle = '*'.repeat(Math.min(ticket.length - 6, 8)) // Maximum 8 asterisks

  return `${start}${middle}${end}`
}

// Removed - use centralized type guards from database types
