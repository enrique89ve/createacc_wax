import type { APIContext, APIRoute } from 'astro'
import type { CreationSession } from '@/types/auth'
import { logger } from '@/lib/logger'
import { createAccount } from '@/lib/create/create-account'
import { delegateResourceCredits } from '@/lib/create/delegate-rc'
import {
	RC_DELEGATION_AMOUNT,
	RC_DELEGATION_CONFIG,
	HTTP_STATUS,
} from '@/consts/constants'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { isSuspiciousUsername } from '@/utils/suspicious-username'
import {
	reserveTicketCredit,
	completeAccountCreationInDB,
	rollbackTicketReservation,
	obfuscateTicket,
	ERROR_CODES,
	accountExistsInDB,
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
import { checkHiveAccount } from '@/utils/check-username'
import { safeCheckAccountOnChain } from '@/utils/validate-hiveuser'
import { hiveChain } from '@/lib/hiveservice'
import { ensureCreation } from '@/lib/session-helpers'
import { isValidationSuccess } from '@/utils/validation-result'
import { validationFailureToResponse } from '@/utils/validation-to-response'
import { checkCreationRateLimit, createRateLimitResponse } from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'
import { validatePowSolution, validateTimingToken, type PowSolution } from '@/lib/pow'
import { TIMING_THRESHOLDS } from '@/consts/pow'
import { analyzeWaxError } from '@/lib/wax-error-utils'
import { AppErrorCode } from '@/consts/errors'
import { setCreationCookie } from '@/lib/session-cookies'
// Side-effect: auto-reconciler (also imported from middleware.ts; ES module imports are idempotent)
import '@/lib/auto-reconciler'

/**
 * Discriminated responses (stable contract):
 * success:true => includes verifiedOnChain, databaseUpdated, isIdempotent; no error/errorCode.
 * success:false => includes error + errorCode and reached state flags.
 */
export type AccountCreationSuccessResponse = {
	readonly success: true
	readonly message: string
	readonly transactionId?: string
	readonly verifiedOnChain: boolean
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
	readonly verifiedOnChain: boolean
	readonly databaseUpdated: boolean
	readonly requiresReconciliation?: boolean
	readonly correlationId?: string
	readonly isIdempotent?: false
}

export type AccountCreationResponse =
	| AccountCreationSuccessResponse
	| AccountCreationFailureResponse

/**
 * In-memory cache to prevent duplicate RC delegations to the same user.
 * @limitation Only works in single-server environments. In multi-server scenarios (horizontal scaling),
 * each instance has its own Set, so duplicate delegations can occur.
 * For multi-server, replace with Redis or a database flag.
 */
const processedUsers = new Set<string>()

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

function scheduleUserCleanup(username: string) {
	setTimeout(() => {
		processedUsers.delete(username)
	}, RC_DELEGATION_CONFIG.CACHE_CLEANUP_MS)
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

function parsePowFields(body: Record<string, unknown>): PowRequestFields | null {
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
			verifiedOnChain: false,
			databaseUpdated: false,
			...extras,
		},
		httpStatus,
		{ noCache: true }
	)
}

function successResponse(
	message: string,
	extras?: Partial<AccountCreationSuccessResponse>
): Response {
	return createJsonResponse(
		{
			success: true,
			message,
			verifiedOnChain: true,
			databaseUpdated: true,
			isIdempotent: false,
			...extras,
		},
		HTTP_STATUS.OK,
		{ noCache: true }
	)
}

// --- Step functions ---

function validatePow(body: Record<string, unknown>): Response | PowRequestFields {
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

async function validateRequest(body: Record<string, unknown>): Promise<Response | ValidatedAccountRequest> {
	const requestValidation = validateRequestData(body)
	if (!isValidationSuccess(requestValidation)) {
		return validationFailureToResponse(requestValidation)
	}

	const validatedData = requestValidation.data
	const { username } = validatedData

	const accountCheck = await checkHiveAccount(username)
	if (!accountCheck.valid) {
		if (accountCheck.reason === 'infrastructure_error') {
			logger.error(`[account-creation] Hive validation infrastructure error: ${accountCheck.error}`)
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

	if (creationSession.accountCreated) {
		return createJsonResponse(
			{
				success: true,
				message: `Account ${username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_ALREADY_CREATED_SESSION}`,
				verifiedOnChain: true,
				databaseUpdated: true,
				isIdempotent: true,
			},
			HTTP_STATUS.OK,
			{ noCache: true }
		)
	}

	const accountAlreadyExists = await accountExistsInDB(username)
	if (accountAlreadyExists) {
		return createJsonResponse(
			{
				success: true,
				message: `Account ${username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_ALREADY_EXISTS}`,
				verifiedOnChain: true,
				databaseUpdated: true,
				isIdempotent: true,
			},
			HTTP_STATUS.OK,
			{ noCache: true }
		)
	}

	return creationSession
}

async function verifyNotOnChain(username: string): Promise<Response | void> {
	const chain = await hiveChain()
	const chainResult = await safeCheckAccountOnChain({
		chain,
		accountName: username,
	})

	if (chainResult.status === 'error') {
		logger.error(`[account-creation] Chain pre-check failed for ${username}: ${chainResult.message}`)
		return failureResponse(
			'Unable to verify account availability',
			'Hive network temporarily unavailable',
			ERROR_CODES.INTERNAL_ERROR,
			HTTP_STATUS.INTERNAL_SERVER_ERROR
		)
	}

	if (chainResult.status === 'found') {
		return failureResponse(
			VALIDATION_ERROR_MESSAGES.ACCOUNT_EXISTS_ON_CHAIN,
			VALIDATION_ERROR_MESSAGES.ACCOUNT_EXISTS_ON_CHAIN,
			ERROR_CODES.INTERNAL_ERROR,
			HTTP_STATUS.CONFLICT
		)
	}
}

async function reserveTicket(
	ticketCode: string,
	correlationId: string
): Promise<Response | void> {
	const obfuscatedTicket = obfuscateTicket(ticketCode)
	logger.warn(
		`[${correlationId}] Creating account with ticket ${obfuscatedTicket}`
	)

	const reservation = await reserveTicketCredit(ticketCode, correlationId)
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

async function createAccountOnChain(
	params: ReturnType<typeof toCreateAccountParams>,
	ticketCode: string,
	correlationId: string,
	username: string
): Promise<Response | { id: string }> {
	try {
		return await createAccount(params)
	} catch (chainError) {
		const errorInfo = analyzeWaxError(chainError)

		if (errorInfo.code === AppErrorCode.ACCOUNT_ALREADY_EXISTS) {
			logger.warn(
				`[${correlationId}] Account ${username} already exists on-chain after pre-check passed. Attempting rollback.`
			)
			const rollbackResult = await rollbackTicketReservation(ticketCode, correlationId)
			if (rollbackResult.success) {
				logger.info(`[${correlationId}] Rollback successful after ACCOUNT_ALREADY_EXISTS.`)
			} else {
				logger.error(
					`[${correlationId}] Rollback failed after ACCOUNT_ALREADY_EXISTS: ${rollbackResult.error}. Enqueueing reconciliation.`
				)
				await enqueueReconciliation({
					correlationId,
					username,
					ticketCode,
					reason: 'ambiguous_chain_error',
					errorCategory: errorInfo.category,
					errorMessage: `rollback_failed_after_account_exists: ${rollbackResult.error}`,
				})
			}
			return failureResponse(
				'Account creation result is uncertain',
				'Account already exists on-chain after pre-check',
				ERROR_CODES.CHAIN_VERIFICATION_FAILED,
				HTTP_STATUS.CONFLICT,
				{ requiresReconciliation: !rollbackResult.success, correlationId }
			)
		}

		if (errorInfo.category === 'business') {
			logger.error(
				`[${correlationId}] On-chain failed (business): ${errorInfo.message}`
			)
			const rollbackResult = await rollbackTicketReservation(ticketCode, correlationId)
			if (!rollbackResult.success) {
				logger.error(
					`[${correlationId}] Rollback failed after business error: ${rollbackResult.error}. Enqueueing reconciliation.`
				)
				await enqueueReconciliation({
					correlationId,
					username,
					ticketCode,
					reason: 'ambiguous_chain_error',
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

function scheduleRcDelegation(username: string): void {
	if (processedUsers.has(username)) return

	processedUsers.add(username)

	setTimeout(async () => {
		for (let attempt = 0; attempt <= RC_DELEGATION_CONFIG.MAX_RETRIES; attempt++) {
			try {
				await delegateResourceCredits({
					delegatee: username,
					maxRc: RC_DELEGATION_AMOUNT,
				})
				logger.info(`[rc-delegation] Successfully delegated RC to ${username}`)
				scheduleUserCleanup(username)
				return
			} catch (error) {
				const errMsg = error instanceof Error ? error.message : 'Unknown error'
				if (attempt < RC_DELEGATION_CONFIG.MAX_RETRIES) {
					logger.warn(`[rc-delegation] Attempt ${attempt + 1} failed for ${username}: ${errMsg}. Retrying...`)
					await new Promise(r => setTimeout(r, RC_DELEGATION_CONFIG.RETRY_DELAY_MS))
				} else {
					logger.error(`[rc-delegation] All attempts failed for ${username}: ${errMsg}`)
					processedUsers.delete(username)
				}
			}
		}
	}, RC_DELEGATION_CONFIG.DELAY_MS)
}

async function completeInDatabase(
	username: string,
	ticketCode: string,
	correlationId: string,
	transactionId: string
): Promise<Response | void> {
	const dbResult = await completeAccountCreationInDB(username, ticketCode, correlationId)
	if (!dbResult.success) {
		const criticalError = `[${correlationId}] WARNING: Account ${username} created on-chain (tx: ${transactionId}) but DB completion failed: ${dbResult.error}. Ticket was already reserved.`
		logger.error(criticalError)
		await enqueueReconciliation({
			correlationId,
			username,
			ticketCode,
			reason: 'db_completion_failed',
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
				verifiedOnChain: true,
				requiresReconciliation: true,
				correlationId,
			}
		)
	}
}

function finalizeSession(context: APIContext, session: ValidatedSession): void {
	setCreationCookie(
		context.cookies,
		{ ...session, accountCreated: true, ticket: undefined },
		context.request
	)
}

// --- POST handler ---

export const POST: APIRoute = async (context) => {
	try {
		const clientIp = resolveClientIp(context)
		const rateLimit = checkCreationRateLimit('account', clientIp)
		if (!rateLimit.allowed) return createRateLimitResponse(rateLimit.retryAfterMs)

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

		const sessionResult = await checkSessionAndIdempotency(creationSession, requestResult.username)
		if (sessionResult instanceof Response) return sessionResult

		const chainCheck = await verifyNotOnChain(requestResult.username)
		if (chainCheck instanceof Response) return chainCheck

		const params = toCreateAccountParams(requestResult)
		const correlationId = `${requestResult.username}-${Date.now().toString(36)}`

		if (!acquireCreationLock(requestResult.username)) {
			return failureResponse(
				'Account creation already in progress',
				'A creation request for this username is already being processed',
				ERROR_CODES.INTERNAL_ERROR,
				HTTP_STATUS.CONFLICT
			)
		}

		try {
			const reserveResult = await reserveTicket(sessionResult.ticket, correlationId)
			if (reserveResult instanceof Response) return reserveResult

			const txResult = await createAccountOnChain(params, sessionResult.ticket, correlationId, requestResult.username)
			if (txResult instanceof Response) return txResult

			scheduleRcDelegation(requestResult.username)

			const dbResult = await completeInDatabase(requestResult.username, sessionResult.ticket, correlationId, txResult.id)
			if (dbResult instanceof Response) return dbResult

			finalizeSession(context, sessionResult)

			return successResponse(
				`Account ${requestResult.username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_CREATION_SUCCESS}`,
				{ transactionId: txResult.id, correlationId }
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
