import { execute, withTransaction } from '@/lib/database'
import { logger } from '@/lib/logger'
import { isHiveUsernameBlocked } from '@/lib/auth/blocked-hive-accounts'
import { creditsService } from '@/lib/credits-service'
import { parseTicketRow } from '@/types/database'
import type { DatabaseTicketRow } from '@/types/database'
import {
  BLOCKCHAIN_STATUS,
  CREATION_ATTEMPT_STATUS,
  HIVE_TX_MODE_VALUES,
  RC_STATUS,
  WAX_STATUS,
  type BlockchainStatus,
  type HiveExecutionMode,
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
  type CreationAttempt,
  type CreationAttemptKeys,
  type CreationAttemptLease,
} from '@/lib/creation-attempts'
import {
  ALL_ERROR_CODES,
  BLOCKCHAIN_ERROR_CODES,
  DATABASE_ERROR_CODES,
  VALIDATION_ERROR_CODES,
  type UnifiedErrorCode,
} from '@/consts/unified-errors'
import {
  RECONCILIATION_CONFIG,
  RECONCILIATION_STATUS,
  type ActionableReconciliationStatus,
  type ReconciliationStatus,
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

    const result = await execute({
      sql: `SELECT * FROM Tickets WHERE code = ?`,
      args: [cleanCode],
    })

    if (result.rows.length === 0) {
      return { isValid: false, error: 'Ticket no encontrado' }
    }

    const ticket = parseTicketRow(result.rows[0])
    if (!ticket) {
      return { isValid: false, error: 'Formato de ticket inválido' }
    }

    if (
      ticket.funding_source === 'builder_credits' &&
      ticket.owner_builder_username &&
      (await isHiveUsernameBlocked(ticket.owner_builder_username))
    ) {
      return { isValid: false, error: 'Ticket temporalmente no disponible' }
    }

    if (!ticket.is_active) {
      return { isValid: false, error: 'Ticket no está activo' }
    }

    // Verify that the ticket has available uses
    if (ticket.remaining_uses <= 0) {
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

    // UPDATE reducing uses and refreshing updated_at
    // is_active and has_been_used are updated automatically
    const updateReturning = await execute({
      sql: `UPDATE Tickets
            SET remaining_uses = CASE WHEN remaining_uses > 0 THEN remaining_uses - 1 ELSE 0 END,
                updated_at = CURRENT_TIMESTAMP
            WHERE code = ? AND remaining_uses > 0 AND revoked_at IS NULL
              AND archived_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM BlockedHiveAccounts b
                WHERE b.hive_username = Tickets.owner_builder_username
              )
            RETURNING id, code`,
      args: [cleanCode],
    })

    if (updateReturning.rows.length === 0) {
      return false // no longer had uses or did not exist
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
  readonly executionMode: HiveExecutionMode
}

export async function getAccountCreationState(
  username: string
): Promise<PersistedAccountCreation | null> {
  try {
    const cleanUsername = sanitizeUsername(username)
    if (!cleanUsername) return null

    const result = await execute({
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
      transactionId:
        typeof row.transaction_id === 'string' ? row.transaction_id : null,
      waxStatus: typeof row.wax_status === 'string' ? row.wax_status : null,
    }
  } catch (error) {
    logger.error('[getAccountCreationState] Failed to load account:', error)
    return null
  }
}

export async function confirmCompletedAttemptAccount(
  correlationId: string
): Promise<boolean> {
  try {
    return await withTransaction(async () => {
      const attempt = await getCreationAttempt(correlationId)
      if (
        !attempt ||
        attempt.status !== CREATION_ATTEMPT_STATUS.COMPLETED ||
        attempt.executionMode !== HIVE_TX_MODE_VALUES.BROADCAST
      ) {
        return false
      }

      const result = await execute({
        sql: `UPDATE Accounts
              SET blockchain_status = ?
              WHERE correlation_id = ?
                AND username = ?
                AND ticket_id = ?
                AND blockchain_status IN (?, ?)
              RETURNING username`,
        args: [
          BLOCKCHAIN_STATUS.CONFIRMED,
          attempt.correlationId,
          attempt.username,
          attempt.ticketId,
          BLOCKCHAIN_STATUS.BROADCASTED,
          BLOCKCHAIN_STATUS.CONFIRMED,
        ],
      })
      return result.rows.length === 1
    })
  } catch (error) {
    logger.error(
      '[confirmCompletedAttemptAccount] Failed to update status:',
      error
    )
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

    const result = await execute({
      sql: `SELECT total_uses, remaining_uses FROM Tickets WHERE code = ?`,
      args: [cleanCode],
    })

    if (result.rows.length === 0) return false

    const row = result.rows[0] as {
      total_uses?: unknown
      remaining_uses?: unknown
    }
    return Number(row.remaining_uses) < Number(row.total_uses)
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
 * Uses a dedicated write transaction to prevent race conditions.
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
    return await withTransaction(async () => {
      const updateResult = await execute({
        sql: `UPDATE Tickets
              SET remaining_uses = CASE
                    WHEN remaining_uses > 0 THEN remaining_uses - 1
                    ELSE 0
                  END,
                  updated_at = CURRENT_TIMESTAMP
              WHERE code = ? AND remaining_uses > 0 AND revoked_at IS NULL AND archived_at IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM BlockedHiveAccounts b
                  WHERE b.hive_username = Tickets.owner_builder_username
                )
              RETURNING *`,
        args: [cleanTicketCode],
      })

      if (updateResult.rows.length === 0) {
        const checkResult = await execute({
          sql: `SELECT * FROM Tickets WHERE code = ?`,
          args: [cleanTicketCode],
        })

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
          error: 'Ticket is unavailable, inactive or has no available uses',
          errorCode: VALIDATION_ERROR_CODES.TICKET_RACE_CONDITION,
          correlationId,
        }
      }

      const reservedTicket = parseTicketRow(updateResult.rows[0])
      if (!reservedTicket) {
        throw new Error('Reserved ticket row has an invalid funding snapshot')
      }

      await insertReservedAttempt({
        correlationId,
        username: cleanUsername,
        ticket: cleanTicketCode,
        ticketId: reservedTicket.id,
        fundingSource: reservedTicket.funding_source,
        ownerBuilderUsername: reservedTicket.owner_builder_username,
        keys: input.keys,
        executionMode: input.executionMode,
      })

      return { success: true, correlationId }
    })
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
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
  correlationId: string,
  lease?: CreationAttemptLease
): Promise<DBOperationResult> {
  if (typeof correlationId !== 'string' || correlationId.length === 0) {
    return {
      success: false,
      error: 'Creation attempt ID is required',
      errorCode: DATABASE_ERROR_CODES.INVALID_INPUT,
      correlationId,
    }
  }

  try {
    return await withTransaction(async () => {
      const attempt = await getCreationAttempt(correlationId)
      if (!attempt) {
        return {
          success: false,
          error: 'Creation attempt not found',
          errorCode: DATABASE_ERROR_CODES.NOT_FOUND,
          correlationId,
        }
      }
      if (attempt.status === CREATION_ATTEMPT_STATUS.ROLLED_BACK) {
        return { success: true, correlationId }
      }
      if (attempt.status === CREATION_ATTEMPT_STATUS.COMPLETED) {
        return {
          success: false,
          error: 'Creation attempt is already completed',
          errorCode: DATABASE_ERROR_CODES.RACE_CONDITION,
          correlationId,
        }
      }

      if (!lease || lease.correlationId !== correlationId) {
        return {
          success: false,
          error: 'A current creation-attempt lease is required for rollback',
          errorCode: DATABASE_ERROR_CODES.RACE_CONDITION,
          correlationId,
        }
      }

      const marked = await markAttemptRolledBack(lease)
      if (!marked) {
        throw new Error('ATTEMPT_TRANSITION_LOST')
      }

      const result = await execute({
        sql: `UPDATE Tickets
              SET remaining_uses = remaining_uses + 1,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
                AND code = ?
                AND funding_source = ?
                AND owner_builder_username IS ?
                AND archived_at IS NULL
                AND remaining_uses < total_uses - retired_uses
              RETURNING id`,
        args: [
          attempt.ticketId,
          attempt.ticket,
          attempt.fundingSource,
          attempt.ownerBuilderUsername,
        ],
      })

      if (result.rows.length !== 1) {
        throw new Error('TICKET_RESTORE_CONFLICT')
      }

      logger.warn(
        `[${correlationId}] Ticket ${obfuscateTicket(attempt.ticket)} use restored for this attempt`
      )
      return { success: true, correlationId }
    })
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    if (
      errorMessage === 'ATTEMPT_TRANSITION_LOST' ||
      errorMessage === 'TICKET_RESTORE_CONFLICT'
    ) {
      return {
        success: false,
        error: 'Creation attempt lost the rollback transition race',
        errorCode: DATABASE_ERROR_CODES.RACE_CONDITION,
        correlationId,
      }
    }
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
 * This function saves the account record and marks builder remaining_uses as consumed.
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

function accountRowFromTransaction(transactionResult: HiveTransactionResult): {
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
  attempt: CreationAttempt,
  options?: CompleteAccountOptions
): Promise<{
  executionMode: string
  blockchainStatus: string
  transactionId: string | null
  waxStatus: string | null
}> {
  const hiveMatched = options?.hiveMatched
  if (transactionResult) {
    if (transactionResult.mode !== attempt.executionMode) {
      throw new Error('TRANSACTION_MODE_MISMATCH')
    }
    if (
      attempt.transactionId !== null &&
      transactionResult.id !== attempt.transactionId
    ) {
      throw new Error('TRANSACTION_ID_MISMATCH')
    }
    return withHiveMatchedStatus(
      accountRowFromTransaction(transactionResult),
      hiveMatched
    )
  }

  if (!attempt.transactionId) {
    if (!hiveMatched) {
      throw new Error('Creation attempt has no prepared transaction')
    }
    return {
      executionMode: attempt.executionMode,
      blockchainStatus: BLOCKCHAIN_STATUS.CONFIRMED,
      transactionId: null,
      waxStatus: waxStatusFromAttempt(attempt),
    }
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
  correlationId: string,
  transactionResult?: HiveTransactionResult,
  options?: CompleteAccountOptions,
  lease?: CreationAttemptLease
): Promise<DBOperationResult> {
  if (typeof correlationId !== 'string' || correlationId.length === 0) {
    return {
      success: false,
      error: 'Creation attempt ID is required',
      errorCode: DATABASE_ERROR_CODES.INVALID_INPUT,
      correlationId,
    }
  }

  try {
    return await withTransaction(async () => {
      const attempt = await getCreationAttempt(correlationId)
      if (!attempt) throw new Error('ATTEMPT_NOT_FOUND')

      if (attempt.status === CREATION_ATTEMPT_STATUS.COMPLETED) {
        const completedAccount = await execute({
          sql: `SELECT username, ticket, ticket_id, builder_username,
                       execution_mode, blockchain_status, transaction_id
                FROM Accounts WHERE correlation_id = ?`,
          args: [correlationId],
        })
        const row = completedAccount.rows[0]
        const expectedTransactionId =
          transactionResult?.id ?? attempt.transactionId
        const expectedStatus = options?.hiveMatched
          ? BLOCKCHAIN_STATUS.CONFIRMED
          : transactionResult
            ? blockchainStatusFromTransaction(transactionResult)
            : attempt.executionMode === HIVE_TX_MODE_VALUES.SIMULATE
              ? BLOCKCHAIN_STATUS.SIMULATED
              : attempt.broadcasted
                ? BLOCKCHAIN_STATUS.BROADCASTED
                : BLOCKCHAIN_STATUS.FAILED
        const statusMatches =
          row?.blockchain_status === expectedStatus ||
          (options?.hiveMatched === true &&
            (row?.blockchain_status === BLOCKCHAIN_STATUS.BROADCASTED ||
              row?.blockchain_status === BLOCKCHAIN_STATUS.CONFIRMED))
        if (
          completedAccount.rows.length === 1 &&
          row.username === attempt.username &&
          row.ticket === attempt.ticket &&
          Number(row.ticket_id) === attempt.ticketId &&
          (typeof row.builder_username === 'string'
            ? row.builder_username
            : null) === attempt.ownerBuilderUsername &&
          row.execution_mode === attempt.executionMode &&
          statusMatches &&
          (typeof row.transaction_id === 'string'
            ? row.transaction_id
            : null) === expectedTransactionId
        ) {
          return { success: true, correlationId }
        }
        throw new Error('COMPLETED_ATTEMPT_ACCOUNT_MISSING')
      }
      if (attempt.status === CREATION_ATTEMPT_STATUS.ROLLED_BACK) {
        throw new Error('ATTEMPT_ALREADY_ROLLED_BACK')
      }

      if (!lease || lease.correlationId !== correlationId) {
        throw new Error('ATTEMPT_LEASE_REQUIRED')
      }

      const ticketInfo = await execute({
        sql: `SELECT id, code, funding_source, owner_builder_username FROM Tickets WHERE id = ?`,
        args: [attempt.ticketId],
      })

      const ticket = ticketInfo.rows[0]
      if (
        !ticket ||
        ticket.code !== attempt.ticket ||
        ticket.funding_source !== attempt.fundingSource ||
        (typeof ticket.owner_builder_username === 'string'
          ? ticket.owner_builder_username
          : null) !== attempt.ownerBuilderUsername
      ) {
        throw new Error('ATTEMPT_TICKET_SNAPSHOT_MISMATCH')
      }

      const transitioned = await markAttemptCompleted(lease)
      if (!transitioned) throw new Error('ATTEMPT_TRANSITION_LOST')

      const accountMeta = await accountRowForCompletion(
        transactionResult,
        attempt,
        options
      )

      try {
        await execute({
          sql: `INSERT INTO Accounts (
                  username, ticket, ticket_id, builder_username, creation_date, registered_at,
                  execution_mode, blockchain_status, transaction_id, correlation_id, wax_status,
                  rc_status, rc_delegated
                )
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            attempt.username,
            attempt.ticket,
            attempt.ticketId,
            attempt.ownerBuilderUsername,
            accountMeta.executionMode,
            accountMeta.blockchainStatus,
            accountMeta.transactionId,
            correlationId,
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

      if (attempt.ownerBuilderUsername) {
        await creditsService.markCreditsAsConsumed(
          attempt.ownerBuilderUsername,
          1,
          attempt.username,
          `creation:${correlationId}:consume`
        )
      }

      return { success: true, correlationId }
    })
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'

    if (errorMessage === 'ACCOUNT_EXISTS') {
      return {
        success: false,
        error: 'Account already exists in database',
        errorCode: BLOCKCHAIN_ERROR_CODES.ACCOUNT_ALREADY_EXISTS,
        correlationId,
      }
    }

    if (errorMessage === 'ATTEMPT_NOT_FOUND') {
      return {
        success: false,
        error: 'Creation attempt not found',
        errorCode: DATABASE_ERROR_CODES.NOT_FOUND,
        correlationId,
      }
    }

    if (
      errorMessage === 'ATTEMPT_ALREADY_ROLLED_BACK' ||
      errorMessage === 'ATTEMPT_TRANSITION_LOST' ||
      errorMessage === 'ATTEMPT_TICKET_SNAPSHOT_MISMATCH' ||
      errorMessage === 'TRANSACTION_MODE_MISMATCH' ||
      errorMessage === 'TRANSACTION_ID_MISMATCH' ||
      errorMessage === 'COMPLETED_ATTEMPT_ACCOUNT_MISSING'
    ) {
      return {
        success: false,
        error: 'Creation attempt cannot be completed in its current state',
        errorCode: DATABASE_ERROR_CODES.RACE_CONDITION,
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

function truncateText(
  value: string | undefined,
  maxLength = RECONCILIATION_MAX_TEXT_LENGTH
): string | null {
  if (!value) return null
  return value.slice(0, maxLength)
}

export async function enqueueReconciliation(params: {
  correlationId: string
  username: string
  ticketCode: string
  reason: 'ambiguous_chain_error' | 'db_completion_failed'
  executionMode?: HiveExecutionMode
  errorCategory?: string
  errorMessage?: string
  transactionId?: string
}): Promise<void> {
  let attempt: Awaited<ReturnType<typeof getCreationAttempt>> = null
  try {
    attempt = await getCreationAttempt(params.correlationId)
  } catch (error) {
    logger.warn(
      `[${params.correlationId}] Could not load creation attempt before reconciliation enqueue: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
  const executionMode = params.executionMode ?? attempt?.executionMode
  if (
    executionMode === HIVE_TX_MODE_VALUES.SIMULATE ||
    (executionMode === undefined && isSimulationMode())
  ) {
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

    await execute({
      sql: `INSERT INTO ReconciliationQueue
            (correlation_id, username, ticket_code, reason, error_category, error_message, transaction_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(correlation_id) DO UPDATE SET
              error_category = COALESCE(excluded.error_category, ReconciliationQueue.error_category),
              error_message = COALESCE(excluded.error_message, ReconciliationQueue.error_message),
              transaction_id = COALESCE(excluded.transaction_id, ReconciliationQueue.transaction_id),
              last_error = COALESCE(excluded.error_message, ReconciliationQueue.last_error)
            WHERE ReconciliationQueue.status NOT IN (?, ?)`,
      args: [
        params.correlationId.slice(0, RECONCILIATION_MAX_TEXT_LENGTH),
        cleanUsername,
        cleanTicket,
        params.reason,
        truncateText(params.errorCategory),
        truncateText(params.errorMessage),
        truncateText(params.transactionId),
        RECONCILIATION_STATUS.RESOLVED,
        RECONCILIATION_STATUS.MANUAL_REVIEW,
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
  readonly status: ReconciliationStatus
  readonly attemptCount: number
  readonly nextAttemptAt: string
}

export interface ReconciliationLease {
  readonly id: number
  readonly token: string
  readonly generation: number
  readonly attemptCount: number
}

function parseReconciliationLease(
  row: Record<string, unknown> | undefined
): ReconciliationLease | null {
  if (!row) return null
  const id = Number(row.id)
  const generation = Number(row.lease_generation)
  const attemptCount = Number(row.attempt_count)
  if (
    !Number.isSafeInteger(id) ||
    id < 1 ||
    typeof row.lease_token !== 'string' ||
    !Number.isSafeInteger(generation) ||
    generation < 1 ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 1
  ) {
    throw new Error('Invalid claimed reconciliation lease')
  }
  return {
    id,
    token: row.lease_token,
    generation,
    attemptCount,
  }
}

/**
 * Fetch a bounded, fair batch that is due or has an expired worker lease.
 */
export async function getPendingReconciliations(): Promise<
  ReconciliationEntry[]
> {
  const result = await execute({
    sql: `SELECT id, correlation_id, username, ticket_code, reason,
                  error_category, error_message, transaction_id, created_at,
                  status, attempt_count, next_attempt_at
           FROM ReconciliationQueue
           WHERE (
             status IN (?, ?) AND next_attempt_at <= CURRENT_TIMESTAMP
           ) OR (
             status = ? AND lease_expires_at <= CURRENT_TIMESTAMP
           )
           ORDER BY next_attempt_at ASC, id ASC
           LIMIT ?`,
    args: [
      RECONCILIATION_STATUS.PENDING,
      RECONCILIATION_STATUS.FAILED,
      RECONCILIATION_STATUS.PROCESSING,
      RECONCILIATION_CONFIG.BATCH_SIZE,
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
    status:
      (row.status as ActionableReconciliationStatus) ||
      RECONCILIATION_STATUS.PENDING,
    attemptCount: (row.attempt_count as number) || 0,
    nextAttemptAt: row.next_attempt_at as string,
  }))
}

/**
 * Fetch one unresolved item that requires an explicit operator evidence review.
 */
export async function getManualReviewReconciliation(
  correlationId: string
): Promise<ReconciliationEntry | null> {
  const result = await execute({
    sql: `SELECT id, correlation_id, username, ticket_code, reason,
                 error_category, error_message, transaction_id, created_at,
                 status, attempt_count, next_attempt_at
          FROM ReconciliationQueue
          WHERE correlation_id = ? AND status = ? AND resolved = FALSE
          LIMIT 1`,
    args: [correlationId, RECONCILIATION_STATUS.MANUAL_REVIEW],
  })
  const row = result.rows[0]
  if (!row) return null
  if (row.status !== RECONCILIATION_STATUS.MANUAL_REVIEW) {
    throw new Error('Invalid manual review reconciliation status')
  }
  return {
    id: row.id as number,
    correlationId: row.correlation_id as string,
    username: row.username as string,
    ticketCode: row.ticket_code as string,
    reason: row.reason as ReconciliationEntry['reason'],
    errorCategory: row.error_category as string | null,
    errorMessage: row.error_message as string | null,
    transactionId: row.transaction_id as string | null,
    createdAt: row.created_at as string,
    status: RECONCILIATION_STATUS.MANUAL_REVIEW,
    attemptCount: (row.attempt_count as number) || 0,
    nextAttemptAt: row.next_attempt_at as string,
  }
}

/**
 * @deprecated Use claimReconciliationEntry and markReconciliationResolved.
 */
export async function resolveReconciliationEntry(
  entryId: number,
  resolvedBy: string
): Promise<boolean> {
  const lease = await claimReconciliationEntry(entryId, resolvedBy)
  return lease ? markReconciliationResolved(lease, resolvedBy) : false
}

/**
 * Atomically claim due work or take over an expired lease. Every subsequent
 * write is fenced by this token and generation.
 */
export async function claimReconciliationEntry(
  entryId: number,
  claimedBy: string
): Promise<ReconciliationLease | null> {
  const token = crypto.randomUUID()
  const result = await execute({
    sql: `UPDATE ReconciliationQueue
          SET status = ?,
              attempt_count = attempt_count + 1,
              processing_since = CURRENT_TIMESTAMP,
              resolved_by = ?,
              lease_token = ?,
              lease_expires_at = datetime('now', '+${RECONCILIATION_CONFIG.LEASE_DURATION_SECONDS} seconds'),
              lease_generation = lease_generation + 1
          WHERE id = ? AND (
            (status IN (?, ?) AND next_attempt_at <= CURRENT_TIMESTAMP)
            OR (status = ? AND lease_expires_at <= CURRENT_TIMESTAMP)
          )
          RETURNING id, lease_token, lease_generation, attempt_count`,
    args: [
      RECONCILIATION_STATUS.PROCESSING,
      claimedBy,
      token,
      entryId,
      RECONCILIATION_STATUS.PENDING,
      RECONCILIATION_STATUS.FAILED,
      RECONCILIATION_STATUS.PROCESSING,
    ],
  })
  return parseReconciliationLease(
    result.rows[0] as Record<string, unknown> | undefined
  )
}

/**
 * Claim a manual-review item for an operator-triggered evidence recheck.
 * The operator identity is retained in resolved_by for the eventual outcome.
 */
export async function claimManualReviewReconciliation(
  entryId: number,
  operatorId: string
): Promise<ReconciliationLease | null> {
  const normalizedOperatorId = operatorId.trim()
  if (!normalizedOperatorId || normalizedOperatorId.length > 128) {
    throw new Error('A valid operator identity is required for manual review')
  }
  const token = crypto.randomUUID()
  const result = await execute({
    sql: `UPDATE ReconciliationQueue
          SET status = ?,
              attempt_count = attempt_count + 1,
              processing_since = CURRENT_TIMESTAMP,
              resolved_by = ?,
              lease_token = ?,
              lease_expires_at = datetime('now', '+${RECONCILIATION_CONFIG.LEASE_DURATION_SECONDS} seconds'),
              lease_generation = lease_generation + 1
          WHERE id = ? AND status = ? AND resolved = FALSE
          RETURNING id, lease_token, lease_generation, attempt_count`,
    args: [
      RECONCILIATION_STATUS.PROCESSING,
      normalizedOperatorId,
      token,
      entryId,
      RECONCILIATION_STATUS.MANUAL_REVIEW,
    ],
  })
  return parseReconciliationLease(
    result.rows[0] as Record<string, unknown> | undefined
  )
}

function reconciliationLeasePredicate(lease: ReconciliationLease): {
  readonly sql: string
  readonly args: readonly (number | string)[]
} {
  return {
    sql: `id = ? AND status = ? AND lease_token = ?
          AND lease_generation = ? AND lease_expires_at > CURRENT_TIMESTAMP`,
    args: [
      lease.id,
      RECONCILIATION_STATUS.PROCESSING,
      lease.token,
      lease.generation,
    ],
  }
}

/**
 * Mark a claimed entry as resolved after successful mutation.
 * Sets both status='resolved' and resolved=TRUE for backward compatibility.
 */
export async function markReconciliationResolved(
  lease: ReconciliationLease,
  resolvedBy: string
): Promise<boolean> {
  const predicate = reconciliationLeasePredicate(lease)
  const result = await execute({
    sql: `UPDATE ReconciliationQueue
          SET status = ?,
              resolved = TRUE,
              resolved_at = CURRENT_TIMESTAMP,
              resolved_by = ?,
              last_error = NULL,
              processing_since = NULL,
              lease_token = NULL,
              lease_expires_at = NULL
          WHERE ${predicate.sql}
          RETURNING id`,
    args: [RECONCILIATION_STATUS.RESOLVED, resolvedBy, ...predicate.args],
  })
  return result.rows.length > 0
}

/**
 * Mark a claimed entry as failed after mutation error.
 * The entry becomes retryable in the next reconciliation cycle.
 */
export async function markReconciliationFailed(
  lease: ReconciliationLease,
  errorMessage: string
): Promise<boolean> {
  const predicate = reconciliationLeasePredicate(lease)
  const exhausted = lease.attemptCount >= RECONCILIATION_CONFIG.MAX_ATTEMPTS
  const backoffMs = Math.min(
    RECONCILIATION_CONFIG.MAX_BACKOFF_MS,
    RECONCILIATION_CONFIG.BASE_BACKOFF_MS *
      2 ** Math.max(0, lease.attemptCount - 1)
  )
  const delaySeconds = Math.ceil(backoffMs / 1000)
  const result = await execute({
    sql: `UPDATE ReconciliationQueue
          SET status = ?,
              resolved = FALSE,
              last_error = ?,
              processing_since = NULL,
              next_attempt_at = CASE WHEN ? = 1 THEN next_attempt_at
                ELSE datetime('now', '+' || ? || ' seconds') END,
              lease_token = NULL,
              lease_expires_at = NULL
          WHERE ${predicate.sql}
          RETURNING id`,
    args: [
      exhausted
        ? RECONCILIATION_STATUS.MANUAL_REVIEW
        : RECONCILIATION_STATUS.FAILED,
      errorMessage.slice(0, 512),
      exhausted ? 1 : 0,
      delaySeconds,
      ...predicate.args,
    ],
  })
  return result.rows.length > 0
}

/**
 * Return an inconclusive operator evidence recheck to manual review without
 * making it eligible for automatic retry.
 */
export async function releaseManualReviewReconciliation(
  lease: ReconciliationLease,
  detail: string
): Promise<boolean> {
  const predicate = reconciliationLeasePredicate(lease)
  const result = await execute({
    sql: `UPDATE ReconciliationQueue
          SET status = ?,
              resolved = FALSE,
              last_error = ?,
              processing_since = NULL,
              lease_token = NULL,
              lease_expires_at = NULL
          WHERE ${predicate.sql}
          RETURNING id`,
    args: [
      RECONCILIATION_STATUS.MANUAL_REVIEW,
      detail.slice(0, 512),
      ...predicate.args,
    ],
  })
  return result.rows.length > 0
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
