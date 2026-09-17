import type { APIContext, APIRoute } from 'astro'
import type { CreationSession } from '@/types/auth'
import { logger } from '@/lib/logger'
import { createAccount } from '@/lib/create/create-account'
import {
  HivePreflightError,
  runAccountCreationPreflight,
} from '@/lib/hive-preflight'
import { getHiveExecutionMode } from '@/lib/hive-execution-mode'
import { maybeQueueRcDelegation } from '@/lib/create/queue-rc-delegation'
import {
  getOpenCreationAttemptByUsername,
  isAttemptStale,
  markAttemptBroadcasting,
  persistAttemptBroadcastOutcome,
  persistAttemptPreparation,
} from '@/lib/creation-attempts'
import { recoverOwnedAccount } from '@/lib/recover-owned-account'
import {
  persistHiveMatchedAccount,
  sameAttemptIdentity,
} from '@/lib/confirm-broadcasted'
import type { CreationAttemptKeys } from '@/lib/creation-attempts'
import {
  BLOCKCHAIN_STATUS,
  CREATION_ATTEMPT_STATUS,
  HIVE_TX_MODE_VALUES,
  type HiveExecutionMode,
} from '@/consts/hive-execution'
import {
  creationFlagsFromPersistedAccount,
  type PersistedAccountCreation,
} from '@/lib/account-status'
import { hiveChain } from '@/lib/hiveservice'
import { validateHiveAccountExistsWithPolling } from '@/utils/validate-hiveuser'
import {
  isSimulationSuccess,
  type HiveTransactionResult,
} from '@/types/hive-transaction'
import { HTTP_STATUS, RECONCILIATION_CONFIG } from '@/consts/constants'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { isSuspiciousUsername } from '@/utils/suspicious-username'
import {
  reserveTicketCredit,
  completeAccountCreationInDB,
  rollbackTicketReservation,
  obfuscateTicket,
  ERROR_CODES,
  getAccountCreationState,
  updateAccountBlockchainStatus,
  enqueueReconciliation,
} from '@/utils/db-ticket-validator'
type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
import { createJsonResponse } from '@/utils/errorResponse'
import {
  validateRequestData,
  validateSessionData,
  toCreateAccountParams,
  type ValidatedAccountRequest,
  type ValidatedSession,
} from '@/lib/create/account-creation.validator'
import { checkHiveAccountFormat } from '@/utils/check-username'
import { ensureCreation } from '@/lib/session-helpers'
import { isValidationSuccess } from '@/utils/validation-result'
import { validationFailureToResponse } from '@/utils/validation-to-response'
import {
  checkCreationRateLimit,
  createRateLimitResponse,
} from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'
import {
  validatePowSolution,
  validateTimingToken,
  type PowSolution,
} from '@/lib/pow'
import { TIMING_THRESHOLDS } from '@/consts/pow'
import { analyzeWaxError } from '@/lib/wax-error-utils'
import { unwrapBroadcastError } from '@/lib/hive-broadcaster'
import { AppErrorCode } from '@/consts/errors'
import { setCreationCookie } from '@/lib/session-cookies'
import {
  fetchHiveAccountAuthorities,
  hiveAuthoritiesMatchExpected,
} from '@/lib/hive-account-authorities'
// Side-effect: auto-reconciler (also imported from middleware.ts; ES module imports are idempotent)
import '@/lib/auto-reconciler'

export type AccountCreationSuccessResponse = {
  readonly success: true
  readonly message: string
  readonly transactionId?: string
  readonly executionMode: HiveExecutionMode
  readonly waxValidated: boolean
  readonly onChainVerified: boolean
  readonly signed: boolean
  readonly authorityVerified: boolean
  readonly broadcasted: boolean
  readonly chainConfirmed: boolean
  readonly databaseUpdated: boolean
  readonly isIdempotent: boolean
  readonly correlationId?: string
  readonly requiresReconciliation?: false
}

export type AccountCreationFailureResponse = {
  readonly success: false
  readonly message: string
  readonly error: string
  readonly errorCode: ErrorCode
  readonly details?: string
  readonly transactionId?: string
  readonly executionMode?: HiveExecutionMode
  readonly waxValidated?: boolean
  readonly onChainVerified?: boolean
  readonly signed?: boolean
  readonly authorityVerified?: boolean
  readonly broadcasted?: boolean
  readonly chainConfirmed?: boolean
  readonly databaseUpdated: boolean
  readonly requiresReconciliation?: boolean
  readonly correlationId?: string
  readonly isIdempotent?: false
}

export type AccountCreationResponse =
  | AccountCreationSuccessResponse
  | AccountCreationFailureResponse

/**
 * In-memory lock to prevent concurrent account creation for the same username.
 * Ensures only one request at a time can reserve credits and create an account.
 *
 * @limitation Single-process only. In horizontal scaling (multiple pods/instances),
 * each instance has its own Set. The DB's atomic reserveTicketCredit() still
 * prevents double-spend at the database level, but two instances could both
 * attempt the on-chain broadcast. The reconciler handles that case safely.
 * For full distributed locking, replace with Redis SETNX or a DB advisory lock.
 */
const creationsInProgress = new Set<string>()

function acquireCreationLock(username: string): boolean {
  if (creationsInProgress.has(username)) return false
  creationsInProgress.add(username)
  return true
}

function releaseCreationLock(username: string): void {
  creationsInProgress.delete(username)
}

function keysFromRequest(
  request: ValidatedAccountRequest
): CreationAttemptKeys {
  return {
    ownerPublicKey: request.ownerPublicKey,
    activePublicKey: request.activePublicKey,
    postingPublicKey: request.postingPublicKey,
    memoPublicKey: request.memoPublicKey,
  }
}

async function creationInProgressResponse(
  username: string,
  correlationId: string
): Promise<Response> {
  return failureResponse(
    'Account creation already in progress',
    `An open creation attempt already exists for ${username}`,
    ERROR_CODES.TICKET_RACE_CONDITION,
    HTTP_STATUS.CONFLICT,
    { correlationId }
  )
}

async function reclaimOpenAttemptForRetry(
  context: APIContext,
  session: ValidatedSession,
  request: ValidatedAccountRequest
): Promise<Response | void> {
  const open = await getOpenCreationAttemptByUsername(request.username)
  if (!open) return
  const keys = keysFromRequest(request)
  if (!sameAttemptIdentity(open, session.ticket, keys)) {
    return creationInProgressResponse(request.username, open.correlationId)
  }

  if (
    open.status === CREATION_ATTEMPT_STATUS.RESERVED ||
    open.status === CREATION_ATTEMPT_STATUS.PREPARED
  ) {
    if (
      !isAttemptStale(open.updatedAt, RECONCILIATION_CONFIG.ATTEMPT_STALE_MS)
    ) {
      return creationInProgressResponse(request.username, open.correlationId)
    }
    await rollbackTicketReservation(session.ticket, open.correlationId)
    return
  }

  const recovered = await recoverOwnedAccount({
    username: request.username,
    ticket: session.ticket,
    keys,
    correlationId: open.correlationId,
  })
  if (recovered.kind === 'recovered') {
    return (
      (await recoverReservedHttpRetry(context, session, request)) ?? undefined
    )
  }

  if (recovered.kind === 'ambiguous' || recovered.kind === 'error') {
    logger.warn(
      `[${open.correlationId}] Holding HTTP retry for ${request.username}; Hive evidence is ${recovered.kind}`
    )
    return creationInProgressResponse(request.username, open.correlationId)
  }

  if (recovered.kind === 'not_found') {
    if (
      !isAttemptStale(open.updatedAt, RECONCILIATION_CONFIG.ATTEMPT_STALE_MS)
    ) {
      return creationInProgressResponse(request.username, open.correlationId)
    }
    await rollbackTicketReservation(session.ticket, open.correlationId)
    return
  }

  if (recovered.kind === 'foreign_account') {
    await rollbackTicketReservation(session.ticket, open.correlationId)
  }
}

// --- Type guard ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// --- PoW parsing ---

interface PowRequestFields {
  readonly pow: PowSolution
  readonly timingTokenId: string
}

function parsePowFields(
  body: Record<string, unknown>
): PowRequestFields | null {
  if (!isRecord(body.pow)) return null
  const pow = body.pow

  if (typeof pow.challengeId !== 'string' || !pow.challengeId) return null
  if (typeof pow.nonce !== 'string' || !pow.nonce) return null
  if (typeof body.timingTokenId !== 'string' || !body.timingTokenId) return null

  return {
    pow: { challengeId: pow.challengeId, nonce: pow.nonce },
    timingTokenId: body.timingTokenId,
  }
}

// --- Response helpers (eliminate boilerplate) ---

function failureResponse(
  message: string,
  error: string,
  errorCode: ErrorCode,
  httpStatus: number,
  extras?: Partial<AccountCreationFailureResponse>
): Response {
  return createJsonResponse(
    {
      success: false,
      message,
      error,
      errorCode,
      executionMode: getHiveExecutionMode(),
      waxValidated: false,
      onChainVerified: false,
      signed: false,
      authorityVerified: false,
      broadcasted: false,
      chainConfirmed: false,
      databaseUpdated: false,
      ...extras,
    },
    httpStatus,
    { noCache: true }
  )
}

function waxFlagsFromResult(tx: HiveTransactionResult, chainConfirmed = false) {
  return {
    executionMode: tx.mode,
    waxValidated: tx.wax.validated,
    onChainVerified: tx.wax.onChainVerified,
    signed: tx.wax.signed,
    authorityVerified: tx.wax.authorityVerified,
    broadcasted: tx.broadcasted,
    chainConfirmed,
  }
}

function idempotentSuccessResponse(
  message: string,
  account: PersistedAccountCreation | null
): Response {
  if (!account) {
    return createJsonResponse(
      {
        success: true,
        message,
        executionMode: getHiveExecutionMode(),
        waxValidated: false,
        onChainVerified: false,
        signed: false,
        authorityVerified: false,
        broadcasted: false,
        chainConfirmed: false,
        databaseUpdated: false,
        isIdempotent: true,
      },
      HTTP_STATUS.OK,
      { noCache: true }
    )
  }

  return createJsonResponse(
    {
      success: true,
      message,
      ...creationFlagsFromPersistedAccount(account),
      transactionId: account.transactionId ?? undefined,
      databaseUpdated: true,
      isIdempotent: true,
    },
    HTTP_STATUS.OK,
    { noCache: true }
  )
}

function successResponse(
  message: string,
  tx: HiveTransactionResult,
  extras?: Partial<AccountCreationSuccessResponse>
): Response {
  return createJsonResponse(
    {
      success: true,
      message,
      ...waxFlagsFromResult(tx),
      databaseUpdated: true,
      isIdempotent: false,
      ...extras,
    },
    HTTP_STATUS.OK,
    { noCache: true }
  )
}

function logCreationOutcome(
  correlationId: string,
  username: string,
  tx: HiveTransactionResult,
  databaseUpdated: boolean
): void {
  logger.info(
    `[${correlationId}] mode=${tx.mode} username=${username} wax=${tx.wax.validated ? 'passed' : 'failed'} authority=${tx.wax.authorityVerified ? 'passed' : 'failed'} broadcast=${tx.broadcasted} db=${databaseUpdated ? 'completed' : 'pending'}`
  )
}

// --- Step functions ---

function validatePow(
  body: Record<string, unknown>
): Response | PowRequestFields {
  const fields = parsePowFields(body)

  if (!fields || !validatePowSolution(fields.pow)) {
    return failureResponse(
      'Proof of work validation failed',
      'Invalid or missing proof of work',
      ERROR_CODES.INTERNAL_ERROR,
      HTTP_STATUS.BAD_REQUEST
    )
  }

  if (!validateTimingToken(fields.timingTokenId, TIMING_THRESHOLDS.account)) {
    return failureResponse(
      'Timing validation failed',
      'Invalid or missing timing token',
      ERROR_CODES.INTERNAL_ERROR,
      HTTP_STATUS.BAD_REQUEST
    )
  }

  return fields
}

async function validateRequest(
  body: Record<string, unknown>
): Promise<Response | ValidatedAccountRequest> {
  const requestValidation = validateRequestData(body)
  if (!isValidationSuccess(requestValidation)) {
    return validationFailureToResponse(requestValidation)
  }

  const validatedData = requestValidation.data
  const { username } = validatedData

  const accountCheck = await checkHiveAccountFormat(username)
  if (!accountCheck.valid) {
    if (accountCheck.reason === 'infrastructure_error') {
      logger.error(
        `[account-creation] Hive format validation infrastructure error: ${accountCheck.error}`
      )
      return failureResponse(
        VALIDATION_ERROR_MESSAGES.INTERNAL_ERROR,
        accountCheck.error,
        ERROR_CODES.INTERNAL_ERROR,
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
    return failureResponse(
      VALIDATION_ERROR_MESSAGES.INVALID_USERNAME_FORMAT,
      VALIDATION_ERROR_MESSAGES.USERNAME_HIVE_STANDARDS,
      ERROR_CODES.INTERNAL_ERROR,
      HTTP_STATUS.BAD_REQUEST
    )
  }

  if (isSuspiciousUsername(username)) {
    return failureResponse(
      VALIDATION_ERROR_MESSAGES.USERNAME_NOT_ALLOWED,
      VALIDATION_ERROR_MESSAGES.USERNAME_NOT_ALLOWED,
      ERROR_CODES.INTERNAL_ERROR,
      HTTP_STATUS.BAD_REQUEST,
      { details: VALIDATION_ERROR_MESSAGES.USERNAME_NOT_ALLOWED_DETAILS }
    )
  }

  return validatedData
}

async function checkSessionAndIdempotency(
  session: CreationSession | null,
  username: string
): Promise<Response | ValidatedSession> {
  const sessionValidation = validateSessionData(session, username)
  if (!isValidationSuccess(sessionValidation)) {
    return validationFailureToResponse(sessionValidation)
  }

  const creationSession = sessionValidation.data

  const existingAccount = await getAccountCreationState(username)

  if (creationSession.accountCreated) {
    return idempotentSuccessResponse(
      `Account ${username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_ALREADY_CREATED_SESSION}`,
      existingAccount
    )
  }

  if (existingAccount) {
    return idempotentSuccessResponse(
      `Account ${username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_ALREADY_EXISTS}`,
      existingAccount
    )
  }

  return creationSession
}

async function runCreationPreflight(
  params: ReturnType<typeof toCreateAccountParams>
): Promise<Response | void> {
  try {
    await runAccountCreationPreflight(params)
  } catch (error) {
    if (error instanceof HivePreflightError) {
      const isConflict =
        error.result.checks.username.status === 'fail' &&
        error.result.checks.username.message.includes('already exists')
      const noClaims = error.result.checks.claimedAccounts.status === 'fail'
      return failureResponse(
        error.message,
        error.message,
        ERROR_CODES.INTERNAL_ERROR,
        isConflict
          ? HTTP_STATUS.CONFLICT
          : noClaims
            ? HTTP_STATUS.SERVICE_UNAVAILABLE
            : HTTP_STATUS.BAD_REQUEST
      )
    }
    const message = error instanceof Error ? error.message : 'Preflight failed'
    return failureResponse(
      'Unable to verify account availability',
      message,
      ERROR_CODES.INTERNAL_ERROR,
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}

async function reserveTicket(
  ticketCode: string,
  correlationId: string,
  username: string,
  keys: CreationAttemptKeys,
  executionMode: HiveExecutionMode
): Promise<Response | void> {
  const obfuscatedTicket = obfuscateTicket(ticketCode)
  logger.warn(
    `[${correlationId}] Creating account with ticket ${obfuscatedTicket}`
  )

  const reservation = await reserveTicketCredit({
    ticketCode,
    correlationId,
    username,
    keys,
    executionMode,
  })
  if (!reservation.success) {
    const isRace = reservation.errorCode === ERROR_CODES.TICKET_RACE_CONDITION
    const isNotFound = reservation.errorCode === ERROR_CODES.TICKET_NOT_FOUND
    return failureResponse(
      isRace
        ? VALIDATION_ERROR_MESSAGES.TICKET_ALREADY_IN_USE
        : isNotFound
          ? VALIDATION_ERROR_MESSAGES.TICKET_INVALID
          : VALIDATION_ERROR_MESSAGES.TICKET_RESERVATION_FAILED,
      reservation.error || VALIDATION_ERROR_MESSAGES.TICKET_RESERVATION_FAILED,
      reservation.errorCode || ERROR_CODES.INTERNAL_ERROR,
      isRace ? HTTP_STATUS.CONFLICT : HTTP_STATUS.BAD_REQUEST
    )
  }
}

async function rollbackAfterFailure(
  ticketCode: string,
  correlationId: string,
  username: string,
  executionMode: HiveExecutionMode,
  reason: 'ambiguous_chain_error' | 'db_completion_failed',
  errorCategory?: string,
  errorMessage?: string,
  transactionId?: string
): Promise<boolean> {
  const rollbackResult = await rollbackTicketReservation(
    ticketCode,
    correlationId
  )
  if (rollbackResult.success) return true

  if (executionMode === HIVE_TX_MODE_VALUES.SIMULATE) {
    logger.error(
      `[${correlationId}] Rollback failed in simulate mode: ${rollbackResult.error}`
    )
    return false
  }

  await enqueueReconciliation({
    correlationId,
    username,
    ticketCode,
    reason,
    executionMode,
    errorCategory,
    errorMessage: `rollback_failed: ${rollbackResult.error}${errorMessage ? ` / ${errorMessage}` : ''}`,
    transactionId,
  })
  return false
}

async function createAccountOnChain(
  params: ReturnType<typeof toCreateAccountParams>,
  ticketCode: string,
  correlationId: string,
  username: string,
  executionMode: HiveExecutionMode
): Promise<Response | HiveTransactionResult> {
  try {
    const tx = await createAccount(
      params,
      { executionMode },
      async snapshot => {
        const persisted = await persistAttemptPreparation(
          correlationId,
          snapshot
        )
        if (!persisted) {
          throw new Error('Failed to persist prepared transaction snapshot')
        }
        if (executionMode !== HIVE_TX_MODE_VALUES.SIMULATE) {
          const marked = await markAttemptBroadcasting(correlationId)
          if (!marked) {
            throw new Error('Creation attempt lost ownership before broadcast')
          }
        }
      }
    )
    await persistAttemptBroadcastOutcome(correlationId, tx)
    return tx
  } catch (chainError) {
    const errorInfo = analyzeWaxError(unwrapBroadcastError(chainError))

    if (executionMode === HIVE_TX_MODE_VALUES.SIMULATE) {
      await rollbackAfterFailure(
        ticketCode,
        correlationId,
        username,
        executionMode,
        'ambiguous_chain_error',
        errorInfo.category,
        errorInfo.message
      )
      throw chainError
    }

    if (errorInfo.code === AppErrorCode.ACCOUNT_ALREADY_EXISTS) {
      return handleAccountAlreadyExists(
        params,
        ticketCode,
        correlationId,
        username,
        executionMode
      )
    }

    if (errorInfo.category === 'business') {
      logger.error(
        `[${correlationId}] On-chain failed (business): ${errorInfo.message}`
      )
      const rollbackResult = await rollbackTicketReservation(
        ticketCode,
        correlationId
      )
      if (!rollbackResult.success) {
        logger.error(
          `[${correlationId}] Rollback failed after business error: ${rollbackResult.error}. Enqueueing reconciliation.`
        )
        await enqueueReconciliation({
          correlationId,
          username,
          ticketCode,
          reason: 'ambiguous_chain_error',
          executionMode,
          errorCategory: errorInfo.category,
          errorMessage: `rollback_failed: ${rollbackResult.error}`,
        })
      }
      throw chainError
    }

    // Ambiguous (network/api/unknown): account MIGHT have been created, do NOT rollback
    logger.error(
      `[${correlationId}] On-chain failed (${errorInfo.category}): ${errorInfo.message}. Ticket NOT rolled back.`
    )
    await enqueueReconciliation({
      correlationId,
      username,
      ticketCode,
      reason: 'ambiguous_chain_error',
      executionMode,
      errorCategory: errorInfo.category,
      errorMessage: errorInfo.message,
    })
    return failureResponse(
      'Account creation result is uncertain due to a network issue',
      'Network error during account creation',
      ERROR_CODES.CHAIN_VERIFICATION_FAILED,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      { requiresReconciliation: true, correlationId }
    )
  }
}

async function completeInDatabase(
  username: string,
  ticketCode: string,
  correlationId: string,
  executionMode: HiveExecutionMode,
  tx?: HiveTransactionResult
): Promise<Response | void> {
  const dbResult = await completeAccountCreationInDB(
    username,
    ticketCode,
    correlationId,
    tx
  )
  if (dbResult.success) return

  const transactionId = tx?.id
  logger.error(
    `[${correlationId}] WARNING: Account ${username} pipeline finished (tx: ${transactionId ?? 'none'}) but DB completion failed: ${dbResult.error}. Ticket was already reserved.`
  )

  if (executionMode === HIVE_TX_MODE_VALUES.SIMULATE) {
    await rollbackAfterFailure(
      ticketCode,
      correlationId,
      username,
      executionMode,
      'db_completion_failed',
      undefined,
      dbResult.error,
      transactionId
    )
    return failureResponse(
      VALIDATION_ERROR_MESSAGES.DB_OPERATIONS_FAILED,
      VALIDATION_ERROR_MESSAGES.DB_OPERATIONS_FAILED,
      dbResult.errorCode || ERROR_CODES.INTERNAL_ERROR,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      {
        details: dbResult.error,
        transactionId,
        ...(tx ? waxFlagsFromResult(tx) : {}),
        requiresReconciliation: false,
        correlationId,
      }
    )
  }

  await enqueueReconciliation({
    correlationId,
    username,
    ticketCode,
    reason: 'db_completion_failed',
    executionMode,
    errorMessage: dbResult.error,
    transactionId,
  })
  return failureResponse(
    VALIDATION_ERROR_MESSAGES.DB_OPERATIONS_FAILED,
    VALIDATION_ERROR_MESSAGES.DB_OPERATIONS_FAILED,
    dbResult.errorCode || ERROR_CODES.INTERNAL_ERROR,
    HTTP_STATUS.INTERNAL_SERVER_ERROR,
    {
      details: dbResult.error,
      transactionId,
      ...(tx ? waxFlagsFromResult(tx) : {}),
      requiresReconciliation: true,
      correlationId,
    }
  )
}

function finalizeSession(context: APIContext, session: ValidatedSession): void {
  setCreationCookie(
    context.cookies,
    { ...session, accountCreated: true, ticket: undefined },
    context.request
  )
}

async function rollbackForeignAccount(
  ticketCode: string,
  correlationId: string,
  username: string,
  executionMode: HiveExecutionMode
): Promise<Response> {
  const rollbackResult = await rollbackTicketReservation(
    ticketCode,
    correlationId
  )
  if (!rollbackResult.success) {
    await enqueueReconciliation({
      correlationId,
      username,
      ticketCode,
      reason: 'ambiguous_chain_error',
      executionMode,
      errorCategory: 'business',
      errorMessage: `rollback_failed_after_foreign_account: ${rollbackResult.error}`,
    })
  }
  return failureResponse(
    'Account already exists on Hive',
    'Account already exists with different authorities',
    ERROR_CODES.ACCOUNT_ALREADY_EXISTS,
    HTTP_STATUS.CONFLICT,
    { requiresReconciliation: !rollbackResult.success, correlationId }
  )
}

async function handleAccountAlreadyExists(
  params: ReturnType<typeof toCreateAccountParams>,
  ticketCode: string,
  correlationId: string,
  username: string,
  executionMode: HiveExecutionMode
): Promise<Response | HiveTransactionResult> {
  const recovered = await recoverOwnedAccount({
    username,
    ticket: ticketCode,
    keys: {
      ownerPublicKey: params.ownerPublicKey,
      activePublicKey: params.activePublicKey,
      postingPublicKey: params.postingPublicKey,
      memoPublicKey: params.memoPublicKey,
    },
    correlationId,
  })

  if (recovered.kind === 'recovered') {
    logger.info(
      `[${correlationId}] Account ${username} on Hive matches this attempt. Recovering without rollback.`
    )
    await persistHiveMatchedAccount({
      username,
      ticket: ticketCode,
      correlationId,
      attempt: recovered.attempt,
    })
    const account = await getAccountCreationState(username)
    return idempotentSuccessResponse(
      `Account ${username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_ALREADY_EXISTS}`,
      account
    )
  }

  if (recovered.kind === 'error' || recovered.kind === 'ambiguous') {
    await enqueueReconciliation({
      correlationId,
      username,
      ticketCode,
      reason: 'ambiguous_chain_error',
      executionMode,
      errorCategory: 'api',
      errorMessage:
        recovered.kind === 'error'
          ? recovered.message
          : 'ambiguous hive authorities',
    })
    return failureResponse(
      'Account creation result is uncertain',
      'Could not verify Hive authorities after ACCOUNT_ALREADY_EXISTS',
      ERROR_CODES.CHAIN_VERIFICATION_FAILED,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      { requiresReconciliation: true, correlationId }
    )
  }

  logger.warn(
    `[${correlationId}] Account ${username} already exists and is not this attempt. Rolling back.`
  )
  return rollbackForeignAccount(
    ticketCode,
    correlationId,
    username,
    executionMode
  )
}

async function recoverReservedHttpRetry(
  context: APIContext,
  session: ValidatedSession,
  request: ValidatedAccountRequest
): Promise<Response | null> {
  const recovered = await recoverOwnedAccount({
    username: request.username,
    ticket: session.ticket,
    keys: keysFromRequest(request),
  })

  if (recovered.kind === 'no_attempt' || recovered.kind === 'not_found')
    return null
  if (recovered.kind === 'error' || recovered.kind === 'ambiguous') return null

  if (recovered.kind === 'foreign_account') {
    return rollbackForeignAccount(
      session.ticket,
      recovered.attempt.correlationId,
      request.username,
      recovered.attempt.executionMode
    )
  }

  const correlationId = recovered.attempt.correlationId
  const persisted = await persistHiveMatchedAccount({
    username: request.username,
    ticket: session.ticket,
    correlationId,
    attempt: recovered.attempt,
  })
  if (!persisted) {
    const dbResult = await completeInDatabase(
      request.username,
      session.ticket,
      correlationId,
      recovered.attempt.executionMode,
      recovered.tx ?? undefined
    )
    if (dbResult instanceof Response) return dbResult
  }
  finalizeSession(context, session)
  const chainConfirmed = true

  if (recovered.tx) {
    logCreationOutcome(correlationId, request.username, recovered.tx, true)
    return successResponse(
      `Account ${request.username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_CREATION_SUCCESS}`,
      recovered.tx,
      {
        transactionId: recovered.tx.id,
        correlationId,
        chainConfirmed,
        isIdempotent: true,
      }
    )
  }

  const account = await getAccountCreationState(request.username)
  return idempotentSuccessResponse(
    `Account ${request.username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_CREATION_SUCCESS}`,
    account
  )
}

async function confirmAccountOnHive(
  username: string,
  correlationId: string,
  expectedKeys: CreationAttemptKeys
): Promise<boolean> {
  const chain = await hiveChain()
  const lookup = await validateHiveAccountExistsWithPolling({
    chain,
    accountName: username,
  })
  if (lookup.status !== 'found') {
    logger.warn(
      `[${correlationId}] Account ${username} broadcasted but not confirmed on Hive (${lookup.status})`
    )
    return false
  }

  const authorityLookup = await fetchHiveAccountAuthorities(username, chain)
  if (
    authorityLookup.status !== 'found' ||
    !hiveAuthoritiesMatchExpected(authorityLookup.authorities, expectedKeys)
  ) {
    logger.warn(
      `[${correlationId}] Account ${username} exists on Hive but expected authorities were not confirmed`
    )
    return false
  }

  const updated = await updateAccountBlockchainStatus(
    username,
    BLOCKCHAIN_STATUS.CONFIRMED
  )
  if (!updated) {
    logger.error(
      `[${correlationId}] Hive confirmed ${username} but DB status update failed`
    )
    return false
  }
  return true
}

// --- POST handler ---

export const POST: APIRoute = async context => {
  try {
    const clientIp = resolveClientIp(context)
    const rateLimit = checkCreationRateLimit('account', clientIp)
    if (!rateLimit.allowed)
      return createRateLimitResponse(rateLimit.retryAfterMs)

    let body: unknown
    try {
      body = await context.request.json()
    } catch {
      return failureResponse(
        'Invalid request body',
        'Failed to parse JSON body',
        ERROR_CODES.INTERNAL_ERROR,
        HTTP_STATUS.BAD_REQUEST
      )
    }
    if (!isRecord(body)) {
      return failureResponse(
        'Invalid request body',
        'Request body must be a JSON object',
        ERROR_CODES.INTERNAL_ERROR,
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const powResult = validatePow(body)
    if (powResult instanceof Response) return powResult

    // Parallelize independent validation: request data + session retrieval
    const [requestResult, creationSession] = await Promise.all([
      validateRequest(body),
      ensureCreation(context),
    ])
    if (requestResult instanceof Response) return requestResult

    const sessionResult = await checkSessionAndIdempotency(
      creationSession,
      requestResult.username
    )
    if (sessionResult instanceof Response) return sessionResult

    const params = toCreateAccountParams(requestResult)
    const preflightResult = await runCreationPreflight(params)
    if (preflightResult instanceof Response) {
      const recovered = await recoverReservedHttpRetry(
        context,
        sessionResult,
        requestResult
      )
      if (recovered) return recovered
      return preflightResult
    }

    const correlationId = `${requestResult.username}-${Date.now().toString(36)}`
    const executionMode = getHiveExecutionMode()

    if (!acquireCreationLock(requestResult.username)) {
      return failureResponse(
        'Account creation already in progress',
        'A creation request for this username is already being processed',
        ERROR_CODES.INTERNAL_ERROR,
        HTTP_STATUS.CONFLICT
      )
    }

    try {
      const reclaimed = await reclaimOpenAttemptForRetry(
        context,
        sessionResult,
        requestResult
      )
      if (reclaimed instanceof Response) return reclaimed

      const reserveResult = await reserveTicket(
        sessionResult.ticket,
        correlationId,
        requestResult.username,
        keysFromRequest(requestResult),
        executionMode
      )
      if (reserveResult instanceof Response) return reserveResult

      const txResult = await createAccountOnChain(
        params,
        sessionResult.ticket,
        correlationId,
        requestResult.username,
        executionMode
      )
      if (txResult instanceof Response) return txResult

      if (
        executionMode === HIVE_TX_MODE_VALUES.SIMULATE &&
        !isSimulationSuccess(txResult)
      ) {
        await rollbackAfterFailure(
          sessionResult.ticket,
          correlationId,
          requestResult.username,
          executionMode,
          'ambiguous_chain_error'
        )
        return failureResponse(
          'Simulation did not pass WAX verification',
          'Simulation failed',
          ERROR_CODES.CHAIN_VERIFICATION_FAILED,
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          {
            transactionId: txResult.id,
            ...waxFlagsFromResult(txResult),
            correlationId,
          }
        )
      }

      const dbResult = await completeInDatabase(
        requestResult.username,
        sessionResult.ticket,
        correlationId,
        executionMode,
        txResult
      )
      if (dbResult instanceof Response) return dbResult

      let chainConfirmed = false
      if (
        txResult.broadcasted &&
        executionMode !== HIVE_TX_MODE_VALUES.SIMULATE
      ) {
        chainConfirmed = await confirmAccountOnHive(
          requestResult.username,
          correlationId,
          keysFromRequest(requestResult)
        )
      }

      maybeQueueRcDelegation(requestResult.username, chainConfirmed)

      finalizeSession(context, sessionResult)
      logCreationOutcome(correlationId, requestResult.username, txResult, true)

      return successResponse(
        `Account ${requestResult.username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_CREATION_SUCCESS}`,
        txResult,
        { transactionId: txResult.id, correlationId, chainConfirmed }
      )
    } finally {
      releaseCreationLock(requestResult.username)
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error(`[account-creation] Unhandled error: ${errMsg}`)
    return failureResponse(
      VALIDATION_ERROR_MESSAGES.UNHANDLED_INTERNAL_ERROR,
      VALIDATION_ERROR_MESSAGES.FAILED_TO_CREATE_ACCOUNT,
      ERROR_CODES.INTERNAL_ERROR,
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
