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
  getCreationAttempt,
  getOpenCreationAttemptByUsername,
  isAttemptStale,
  claimCreationAttempt,
  markAttemptBroadcasting,
  persistAttemptBroadcastOutcome,
  persistAttemptPreparation,
  type CreationAttemptLease,
} from '@/lib/creation-attempts'
import { recoverOwnedAccount } from '@/lib/recover-owned-account'
import { inspectHiveCreationEvidence } from '@/lib/creation-evidence'
import { sameAttemptIdentity } from '@/lib/confirm-broadcasted'
import type { CreationAttemptKeys } from '@/lib/creation-attempts'
import {
  CREATION_ATTEMPT_STATUS,
  HIVE_TX_MODE_VALUES,
  type HiveExecutionMode,
} from '@/consts/hive-execution'
import {
  creationFlagsFromPersistedAccount,
  type PersistedAccountCreation,
} from '@/lib/account-status'
import {
  isSimulationSuccess,
  type HiveTransactionResult,
} from '@/types/hive-transaction'
import { HTTP_STATUS, RECONCILIATION_CONFIG } from '@/consts/constants'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { checkUsernamePolicy } from '@/lib/username-policy'
import {
  reserveTicketCredit,
  completeAccountCreationInDB,
  rollbackTicketReservation,
  obfuscateTicket,
  ERROR_CODES,
  getAccountCreationState,
  confirmCompletedAttemptAccount,
  enqueueReconciliation,
} from '@/utils/db-ticket-validator'
import { reconcileCreationAttempt } from '@/lib/creation-reconciler'
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
    ERROR_CODES.ACCOUNT_CREATION_IN_PROGRESS,
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
    const lease = await claimCreationAttempt(open.correlationId)
    if (lease) await rollbackTicketReservation(open.correlationId, lease)
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
    const evidence = await inspectHiveCreationEvidence(open)
    if (evidence.kind === 'not_executed') {
      const lease = await claimCreationAttempt(open.correlationId)
      if (lease) {
        const rolledBack = await rollbackTicketReservation(
          open.correlationId,
          lease
        )
        if (rolledBack.success) return
      }
    }
    if (evidence.kind === 'created') {
      return (
        (await recoverReservedHttpRetry(context, session, request)) ?? undefined
      )
    }
    return failureResponse(
      'Account creation is still being reconciled',
      'Hive has not provided final evidence for the existing broadcast; its ticket use remains reserved.',
      ERROR_CODES.CHAIN_VERIFICATION_FAILED,
      HTTP_STATUS.ACCEPTED,
      { requiresReconciliation: true, correlationId: open.correlationId }
    )
  }

  if (recovered.kind === 'foreign_account') {
    return rollbackForeignAccount(
      session.ticket,
      open.correlationId,
      request.username,
      open.executionMode
    )
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

  const usernamePolicy = await checkUsernamePolicy(username)
  if (usernamePolicy.status === 'unavailable') {
    return failureResponse(
      'Unable to verify username policy',
      'Username policy check is temporarily unavailable',
      ERROR_CODES.USERNAME_POLICY_UNAVAILABLE,
      HTTP_STATUS.SERVICE_UNAVAILABLE
    )
  }
  if (usernamePolicy.status === 'suspicious') {
    return failureResponse(
      VALIDATION_ERROR_MESSAGES.USERNAME_NOT_ALLOWED,
      VALIDATION_ERROR_MESSAGES.USERNAME_NOT_ALLOWED,
      ERROR_CODES.USERNAME_NOT_ALLOWED,
      HTTP_STATUS.BAD_REQUEST,
      { details: VALIDATION_ERROR_MESSAGES.USERNAME_NOT_ALLOWED_DETAILS }
    )
  }
  if (usernamePolicy.status === 'similar') {
    return failureResponse(
      VALIDATION_ERROR_MESSAGES.USERNAME_NOT_ALLOWED,
      'This username is too similar to an account created recently',
      ERROR_CODES.USERNAME_TOO_SIMILAR,
      HTTP_STATUS.BAD_REQUEST
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
  lease: CreationAttemptLease,
  reason: 'ambiguous_chain_error' | 'db_completion_failed',
  errorCategory?: string,
  errorMessage?: string,
  transactionId?: string
): Promise<boolean> {
  const rollbackResult = await rollbackTicketReservation(correlationId, lease)
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
): Promise<
  | Response
  | { readonly tx: HiveTransactionResult; readonly lease: CreationAttemptLease }
> {
  const claimedLease = await claimCreationAttempt(correlationId)
  if (!claimedLease) return creationInProgressResponse(username, correlationId)
  let lease: CreationAttemptLease = claimedLease

  try {
    const tx = await createAccount(
      params,
      { executionMode },
      async snapshot => {
        const persisted = await persistAttemptPreparation(lease, snapshot)
        if (!persisted) {
          throw new Error('Failed to persist prepared transaction snapshot')
        }
        lease = persisted
        if (executionMode !== HIVE_TX_MODE_VALUES.SIMULATE) {
          const marked = await markAttemptBroadcasting(lease)
          if (!marked) {
            throw new Error('Creation attempt lost ownership before broadcast')
          }
          lease = marked
        }
      }
    )
    const persisted = await persistAttemptBroadcastOutcome(lease, tx)
    if (!persisted) {
      throw new Error('Creation attempt lost ownership after broadcast')
    }
    lease = persisted
    return { tx, lease }
  } catch (chainError) {
    const errorInfo = analyzeWaxError(unwrapBroadcastError(chainError))

    if (executionMode === HIVE_TX_MODE_VALUES.SIMULATE) {
      await rollbackAfterFailure(
        ticketCode,
        correlationId,
        username,
        executionMode,
        lease,
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
        executionMode,
        lease
      )
    }

    if (errorInfo.category === 'business') {
      logger.error(
        `[${correlationId}] On-chain failed (business): ${errorInfo.message}`
      )
      const resolution = await reconcileCreationAttempt(correlationId, {
        lease,
      })
      if (
        resolution.kind === 'rolled_back' ||
        (resolution.kind === 'already_terminal' &&
          resolution.status === 'rolled_back')
      ) {
        throw chainError
      }
      if (
        resolution.kind === 'completed' ||
        (resolution.kind === 'already_terminal' &&
          resolution.status === 'completed')
      ) {
        return idempotentSuccessResponse(
          `Account ${username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_CREATION_SUCCESS}`,
          await getAccountCreationState(username)
        )
      }
      const reason =
        resolution.kind === 'pending' ||
        resolution.kind === 'review' ||
        resolution.kind === 'failed'
          ? resolution.reason
          : `Creation reconciliation result: ${resolution.kind}`
      await enqueueReconciliation({
        correlationId,
        username,
        ticketCode,
        reason: 'ambiguous_chain_error',
        executionMode,
        errorCategory: errorInfo.category,
        errorMessage: reason,
      })
      return failureResponse(
        'Account creation is still being reconciled',
        'Hive has not provided enough final evidence to close this attempt safely.',
        ERROR_CODES.CHAIN_VERIFICATION_FAILED,
        HTTP_STATUS.ACCEPTED,
        { requiresReconciliation: true, correlationId }
      )
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
  tx: HiveTransactionResult | undefined,
  lease: CreationAttemptLease
): Promise<Response | void> {
  const dbResult = await completeAccountCreationInDB(
    correlationId,
    tx,
    undefined,
    lease
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
      lease,
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
  executionMode: HiveExecutionMode,
  existingLease?: CreationAttemptLease
): Promise<Response> {
  const result = await reconcileCreationAttempt(correlationId, {
    lease: existingLease,
  })
  if (
    result.kind !== 'rolled_back' &&
    !(result.kind === 'already_terminal' && result.status === 'rolled_back')
  ) {
    await enqueueReconciliation({
      correlationId,
      username,
      ticketCode,
      reason: 'ambiguous_chain_error',
      executionMode,
      errorCategory: 'business',
      errorMessage:
        result.kind === 'pending' ||
        result.kind === 'review' ||
        result.kind === 'failed'
          ? result.reason
          : `Creation reconciliation result: ${result.kind}`,
    })
  }
  if (
    result.kind === 'completed' ||
    (result.kind === 'already_terminal' && result.status === 'completed')
  ) {
    return idempotentSuccessResponse(
      `Account ${username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_CREATION_SUCCESS}`,
      await getAccountCreationState(username)
    )
  }
  const rolledBack =
    result.kind === 'rolled_back' ||
    (result.kind === 'already_terminal' && result.status === 'rolled_back')
  return failureResponse(
    rolledBack
      ? 'Account already exists on Hive'
      : 'Account creation requires reconciliation',
    rolledBack
      ? 'Account already exists with different authorities'
      : 'Current Hive state does not prove this attempt failed; its ticket use remains reserved.',
    ERROR_CODES.ACCOUNT_ALREADY_EXISTS,
    rolledBack ? HTTP_STATUS.CONFLICT : HTTP_STATUS.ACCEPTED,
    { requiresReconciliation: !rolledBack, correlationId }
  )
}

async function handleAccountAlreadyExists(
  params: ReturnType<typeof toCreateAccountParams>,
  ticketCode: string,
  correlationId: string,
  username: string,
  executionMode: HiveExecutionMode,
  lease: CreationAttemptLease
): Promise<Response> {
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
    const reconciled = await reconcileCreationAttempt(correlationId, { lease })
    if (
      reconciled.kind !== 'completed' &&
      !(
        reconciled.kind === 'already_terminal' &&
        reconciled.status === 'completed'
      )
    ) {
      await enqueueReconciliation({
        correlationId,
        username,
        ticketCode,
        reason: 'ambiguous_chain_error',
        executionMode,
        errorMessage:
          reconciled.kind === 'pending' ||
          reconciled.kind === 'review' ||
          reconciled.kind === 'failed'
            ? reconciled.reason
            : `Creation reconciliation result: ${reconciled.kind}`,
      })
      return failureResponse(
        'Account creation is still being reconciled',
        'Hive has not provided enough final evidence to close this attempt safely.',
        ERROR_CODES.CHAIN_VERIFICATION_FAILED,
        HTTP_STATUS.ACCEPTED,
        { requiresReconciliation: true, correlationId }
      )
    }
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
    `[${correlationId}] Account ${username} already exists; reconciling persisted transaction evidence.`
  )
  return rollbackForeignAccount(
    ticketCode,
    correlationId,
    username,
    executionMode,
    lease
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

  if (recovered.kind === 'no_attempt' || recovered.kind === 'not_found') {
    return null
  }
  if (recovered.kind === 'error' || recovered.kind === 'ambiguous') {
    return null
  }

  const correlationId = recovered.attempt.correlationId
  const reconciled = await reconcileCreationAttempt(correlationId)
  if (
    reconciled.kind !== 'completed' &&
    !(
      reconciled.kind === 'already_terminal' &&
      reconciled.status === 'completed'
    )
  ) {
    const reason =
      reconciled.kind === 'pending' ||
      reconciled.kind === 'review' ||
      reconciled.kind === 'failed'
        ? reconciled.reason
        : `Creation reconciliation result: ${reconciled.kind}`
    await enqueueReconciliation({
      correlationId,
      username: request.username,
      ticketCode: session.ticket,
      reason: 'ambiguous_chain_error',
      executionMode: recovered.attempt.executionMode,
      errorMessage: reason,
      transactionId: recovered.attempt.transactionId ?? undefined,
    })
    return failureResponse(
      'Account creation is still being reconciled',
      'Hive has not provided enough final evidence to close this attempt safely.',
      ERROR_CODES.CHAIN_VERIFICATION_FAILED,
      HTTP_STATUS.ACCEPTED,
      { requiresReconciliation: true, correlationId }
    )
  }
  finalizeSession(context, session)
  const chainConfirmed = true

  if (recovered.kind === 'recovered' && recovered.tx) {
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
  correlationId: string
): Promise<boolean> {
  const attempt = await getCreationAttempt(correlationId)
  if (!attempt) return false
  const evidence = await inspectHiveCreationEvidence(attempt)
  if (evidence.kind !== 'created') {
    logger.warn(
      `[${correlationId}] Hive creation evidence for ${username} is ${evidence.kind}`
    )
    return false
  }

  const updated = await confirmCompletedAttemptAccount(correlationId)
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
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit.retryAfterMs)
    }

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

      const creation = await createAccountOnChain(
        params,
        sessionResult.ticket,
        correlationId,
        requestResult.username,
        executionMode
      )
      if (creation instanceof Response) return creation
      const { tx: txResult, lease } = creation

      if (
        executionMode === HIVE_TX_MODE_VALUES.SIMULATE &&
        !isSimulationSuccess(txResult)
      ) {
        await rollbackAfterFailure(
          sessionResult.ticket,
          correlationId,
          requestResult.username,
          executionMode,
          lease,
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
        txResult,
        lease
      )
      if (dbResult instanceof Response) return dbResult

      let chainConfirmed = false
      if (
        txResult.broadcasted &&
        executionMode !== HIVE_TX_MODE_VALUES.SIMULATE
      ) {
        chainConfirmed = await confirmAccountOnHive(
          requestResult.username,
          correlationId
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
