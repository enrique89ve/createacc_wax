import type { APIRoute } from 'astro'
import { createAccount } from '@/lib/create/create-account'
import { CreationSessionManager } from '@/lib/session-manager'
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
import { AccountCreationValidator } from '@/lib/create/account-creation.validator'
import { checkHiveAccount } from '@/utils/check-username'
import { validateHiveAccountExists } from '@/utils/validate-hiveuser'
import { hiveChain } from '@/lib/hiveservice'
import { isValidationSuccess } from '@/utils/validation-result'
import { validationFailureToResponse } from '@/utils/validation-to-response'
import { checkCreationRateLimit, createRateLimitResponse } from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'
import { analyzeWaxError } from '@/lib/wax-error-utils'
import { AppErrorCode } from '@/consts/errors'

/**
 * Respuestas discriminadas (contrato estable):
 * success:true => incluye verifiedOnChain, databaseUpdated, isIdempotent; no error/errorCode.
 * success:false => incluye error + errorCode y flags de estado alcanzado.
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
 * Cache en memoria para evitar delegaciones RC duplicadas al mismo usuario.
 * @limitation Solo funciona en single-server. En multi-server (horizontal scaling),
 * cada instancia tiene su propio Set, por lo que delegaciones duplicadas pueden ocurrir.
 * Para multi-server, reemplazar con Redis o flag en base de datos.
 */
const processedUsers = new Set<string>()

// Función para limpiar usuario del cache después de 5 minutos
function scheduleUserCleanup(username: string) {
  setTimeout(() => {
    processedUsers.delete(username)
  }, RC_DELEGATION_CONFIG.CACHE_CLEANUP_MS)
}

/**
 * ENDPOINT DE CREACIÓN DE CUENTA HIVE
 *
 * Este endpoint maneja todo el proceso de creación de una nueva cuenta Hive.
 * Flujo principal:
 *
 * 1. Validación de datos del request (formato, claves públicas)
 * 2. Validación de sesión (descarga confirmada + ticket requerido)
 * 3. Validación de username contra blockchain Hive (formato)
 * 4. Verificación de username sospechoso
 * 5. Idempotencia de sesión (cuenta ya creada)
 * 6. Idempotencia en base de datos (cuenta ya existe)
 * 6.5. Verificación on-chain: rechazar si la cuenta ya existe en Hive
 * 7. Reservar crédito del ticket en DB (ANTES de on-chain)
 * 8. Creación de cuenta en blockchain (con rollback/reconciliación si falla)
 * 9. Delegación de Resource Credits (async, post-creación on-chain)
 * 10. Completar operaciones en DB (save account, mark credits)
 * 11. Limpieza de sesión
 *
 * Patrones usados:
 * - Validation Result Pattern para separar validación de HTTP
 * - Early Return Pattern para flujo de control claro
 * - Atomic Operations para consistencia de datos
 * - Correlation ID para trazabilidad
 *
 * @param context - Contexto de la petición HTTP de Astro
 * @returns Response JSON con resultado de creación
 */
export const POST: APIRoute = async context => {
  try {
    // F3 FIX: Rate-limit account creation (stricter: 5 req per 5 min per IP)
    const clientIp = resolveClientIp(context)
    const rateLimit = checkCreationRateLimit('account', clientIp)
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit.retryAfterMs)
    }

    const validator = new AccountCreationValidator()

    // PASO 1: Validar datos del request (formato, claves públicas)
    const requestValidation = await validator.validateRequestData(context)
    if (!isValidationSuccess(requestValidation)) {
      return validationFailureToResponse(requestValidation)
    }

    const validatedData = requestValidation.data
    const { username } = validatedData

    // PASO 2: Validar sesión de creación (descarga confirmada + username match)
    const sessionValidation = await validator.validateSessionData(context, username)
    if (!isValidationSuccess(sessionValidation)) {
      return validationFailureToResponse(sessionValidation)
    }

    const creationSession = sessionValidation.data

    // PASO 3: Validar username contra blockchain Hive (business logic)
    const isValidAccount = await checkHiveAccount(username)
    if (!isValidAccount) {
      return createJsonResponse(
        {
          success: false,
          message: VALIDATION_ERROR_MESSAGES.INVALID_USERNAME_FORMAT,
          error: VALIDATION_ERROR_MESSAGES.USERNAME_HIVE_STANDARDS,
          errorCode: ERROR_CODES.INTERNAL_ERROR,
          verifiedOnChain: false,
          databaseUpdated: false,
        },
        HTTP_STATUS.BAD_REQUEST,
        { noCache: true }
      )
    }

    // PASO 4: Verificar si es un usuario sospechoso (validación de seguridad)
    if (isSuspiciousUsername(username)) {
      return createJsonResponse(
        {
          success: false,
          message: VALIDATION_ERROR_MESSAGES.USERNAME_NOT_ALLOWED,
          error: VALIDATION_ERROR_MESSAGES.USERNAME_NOT_ALLOWED,
          details: VALIDATION_ERROR_MESSAGES.USERNAME_NOT_ALLOWED_DETAILS,
          errorCode: ERROR_CODES.INTERNAL_ERROR,
          verifiedOnChain: false,
          databaseUpdated: false,
        },
        HTTP_STATUS.BAD_REQUEST,
        { noCache: true }
      )
    }

    // PASO 5: Verificar si la cuenta ya fue creada en sesión (idempotencia)
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

    // PASO 6: Verificación de idempotencia en DB (cuenta ya existe)
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

    // PASO 6.5: Verificar que la cuenta NO exista on-chain (anti-exploit)
    // Prevents ticket consumption for pre-existing Hive accounts.
    // Without this check, an attacker could submit an existing username,
    // pass format validation (PASO 3), pass DB idempotency (PASO 6),
    // reserve the ticket (PASO 7), fail on-chain with ACCOUNT_ALREADY_EXISTS,
    // and still consume the ticket credit.
    const chain = await hiveChain()
    const existsOnChain = await validateHiveAccountExists({
      chain,
      accountName: username,
    })
    if (existsOnChain) {
      chain.delete()
      return createJsonResponse(
        {
          success: false,
          message: VALIDATION_ERROR_MESSAGES.ACCOUNT_EXISTS_ON_CHAIN,
          error: VALIDATION_ERROR_MESSAGES.ACCOUNT_EXISTS_ON_CHAIN,
          errorCode: ERROR_CODES.INTERNAL_ERROR,
          verifiedOnChain: false,
          databaseUpdated: false,
        },
        HTTP_STATUS.CONFLICT,
        { noCache: true }
      )
    }
    chain.delete()

    const params = validator.toCreateAccountParams(validatedData)
    const ticketCode = creationSession.ticket!

    // Generar correlation ID para trazabilidad
    const correlationId = `${username}-${Date.now().toString(36)}`
    const obfuscatedTicket = obfuscateTicket(ticketCode)
    console.warn(
      `[${correlationId}] Creating account for ${username} with ticket ${obfuscatedTicket}`
    )

    // PASO 7: RESERVAR TICKET EN DB (ANTES de on-chain)
    // F2 FIX: Validate and atomically reserve the ticket credit BEFORE
    // the irreversible on-chain operation. This prevents race conditions
    // where two sessions with the same ticket both create accounts.
    const reservation = await reserveTicketCredit(ticketCode, correlationId)
    if (!reservation.success) {
      const isRace = reservation.errorCode === ERROR_CODES.TICKET_RACE_CONDITION
      const isNotFound = reservation.errorCode === ERROR_CODES.TICKET_NOT_FOUND
      return createJsonResponse(
        {
          success: false,
          message: isRace
            ? VALIDATION_ERROR_MESSAGES.TICKET_ALREADY_IN_USE
            : isNotFound
              ? VALIDATION_ERROR_MESSAGES.TICKET_INVALID
              : VALIDATION_ERROR_MESSAGES.TICKET_RESERVATION_FAILED,
          error: reservation.error || VALIDATION_ERROR_MESSAGES.TICKET_RESERVATION_FAILED,
          errorCode: reservation.errorCode || ERROR_CODES.INTERNAL_ERROR,
          verifiedOnChain: false,
          databaseUpdated: false,
        },
        isRace ? HTTP_STATUS.CONFLICT : HTTP_STATUS.BAD_REQUEST,
        { noCache: true }
      )
    }

    // PASO 8: Crear la cuenta en la blockchain (ticket already reserved)
    let transaction: { id: string }
    try {
      transaction = await createAccount(params)
    } catch (chainError) {
      const errorInfo = analyzeWaxError(chainError)

      if (errorInfo.code === AppErrorCode.ACCOUNT_ALREADY_EXISTS) {
        // Account exists on-chain despite passing the pre-check (PASO 6.5).
        // This is either a TOCTOU race (someone else created it between our
        // check and broadcast) or our own retry (broadcast #1 succeeded but
        // response was lost). We cannot distinguish these cases, so treat
        // as ambiguous — do NOT rollback, enqueue for reconciliation.
        console.warn(
          `[${correlationId}] Account ${username} already exists on-chain after pre-check passed. Enqueueing reconciliation.`
        )
        await enqueueReconciliation({
          correlationId,
          username,
          ticketCode,
          // Keep reason within persisted enum/check constraint.
          reason: 'ambiguous_chain_error',
          errorCategory: errorInfo.category,
          errorMessage: `account_exists_after_precheck: ${errorInfo.message}`,
        })
        return createJsonResponse(
          {
            success: false,
            message: 'Account creation result is uncertain',
            error: 'Account already exists on-chain after pre-check',
            errorCode: ERROR_CODES.CHAIN_VERIFICATION_FAILED,
            verifiedOnChain: false,
            databaseUpdated: false,
            requiresReconciliation: true,
            correlationId,
          },
          HTTP_STATUS.CONFLICT,
          { noCache: true }
        )
      } else if (errorInfo.category === 'business') {
        // Other deterministic business errors (e.g. insufficient RC):
        // account NOT created, safe to rollback
        console.error(
          `[${correlationId}] On-chain failed (business): ${errorInfo.message}`
        )
        await rollbackTicketReservation(ticketCode, correlationId)
        throw chainError // → outer catch with generic message
      } else {
        // Ambiguous (network/api/unknown): account MIGHT have been created, do NOT rollback
        console.error(
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
        return createJsonResponse(
          {
            success: false,
            message: 'Account creation result is uncertain due to a network issue',
            error: 'Network error during account creation',
            errorCode: ERROR_CODES.CHAIN_VERIFICATION_FAILED,
            verifiedOnChain: false,
            databaseUpdated: false,
            requiresReconciliation: true,
            correlationId,
          },
          HTTP_STATUS.INTERNAL_SERVER_ERROR,
          { noCache: true }
        )
      }
    }

    // PASO 9: Delegación RC (siempre que la cuenta se cree on-chain)
    if (!processedUsers.has(username)) {
      processedUsers.add(username)
      setTimeout(async () => {
        try {
          await delegateResourceCredits({
            delegatee: username,
            maxRc: RC_DELEGATION_AMOUNT,
          })
        } catch (delegationError) {
          // La delegación falla pero no afecta la creación de cuenta
        } finally {
          scheduleUserCleanup(username)
        }
      }, RC_DELEGATION_CONFIG.DELAY_MS)
    }

    // PASO 10: Completar operaciones en DB (save account, mark credits consumed)
    const dbResult = await completeAccountCreationInDB(
      username,
      ticketCode,
      correlationId
    )
    if (!dbResult.success) {
      // Account exists on-chain and ticket is reserved but DB completion failed
      const criticalError = `[${correlationId}] WARNING: Account ${username} created on-chain (tx: ${transaction.id}) but DB completion failed: ${dbResult.error}. Ticket was already reserved.`
      console.error(criticalError)
      await enqueueReconciliation({
        correlationId,
        username,
        ticketCode,
        reason: 'db_completion_failed',
        errorMessage: dbResult.error,
        transactionId: transaction.id,
      })
      return createJsonResponse(
        {
          success: false,
          message: VALIDATION_ERROR_MESSAGES.DB_OPERATIONS_FAILED,
          error: VALIDATION_ERROR_MESSAGES.DB_OPERATIONS_FAILED,
          details: dbResult.error,
          transactionId: transaction.id,
          verifiedOnChain: true,
          databaseUpdated: false,
          requiresReconciliation: true,
          correlationId,
          errorCode: dbResult.errorCode || ERROR_CODES.INTERNAL_ERROR,
        },
        HTTP_STATUS.INTERNAL_SERVER_ERROR,
        { noCache: true }
      )
    }

    // PASO 11: Limpiar la sesión (marcar como completada y limpiar ticket)
    const sessionManager = new CreationSessionManager(
      context.cookies,
      context.request
    )
    sessionManager.set({
      ...creationSession,
      accountCreated: true,
      ticket: undefined,
    })

    return createJsonResponse(
      {
        success: true,
        message: `Account ${username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_CREATION_SUCCESS}`,
        transactionId: transaction.id,
        verifiedOnChain: true,
        databaseUpdated: true,
        isIdempotent: false,
        correlationId,
      },
      HTTP_STATUS.OK,
      { noCache: true }
    )
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    console.error(`[account-creation] Unhandled error: ${errMsg}`)
    return createJsonResponse(
      {
        success: false,
        message: VALIDATION_ERROR_MESSAGES.UNHANDLED_INTERNAL_ERROR,
        error: VALIDATION_ERROR_MESSAGES.FAILED_TO_CREATE_ACCOUNT,
        errorCode: ERROR_CODES.INTERNAL_ERROR,
        verifiedOnChain: false,
        databaseUpdated: false,
      },
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      { noCache: true }
    )
  }
}
