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
import {
  isSuspiciousUsername,
  getSuspiciousReason,
} from '@/utils/suspicious-username'
import {
  // checkIdempotency, // removido para no validar reutilización de ticket
  completeAccountCreationInDB,
  obfuscateTicket,
  ERROR_CODES,
  accountExistsInDB,
} from '@/utils/db-ticket-validator'
type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]
import { createJsonResponse } from '@/utils/errorResponse'
import { AccountCreationValidator } from '@/lib/create/account-creation.validator'
import { checkHiveAccount } from '@/utils/check-username'
import { isValidationSuccess } from '@/utils/validation-result'
import { validationFailureToResponse } from '@/utils/validation-to-response'

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

// Cache simple para evitar delegaciones duplicadas
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
 * 2. Validación de sesión (descarga confirmada)
 * 3. Validaciones de negocio (username válido, no sospechoso)
 * 4. Verificación de idempotencia (evitar duplicación)
 * 5. Creación de cuenta en blockchain
 * 6. Operaciones de base de datos atómicas
 * 7. Limpieza de sesión
 * 8. Delegación de Resource Credits (async)
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
    const validator = new AccountCreationValidator()

    // PASO 1: Validar datos del request (formato, claves públicas)
    const requestValidation = await validator.validateRequestData(context)
    if (!isValidationSuccess(requestValidation)) {
      return validationFailureToResponse(requestValidation)
    }

    // PASO 2: Validar sesión de creación (descarga confirmada)
    const sessionValidation = await validator.validateSessionData(context)
    if (!isValidationSuccess(sessionValidation)) {
      return validationFailureToResponse(sessionValidation)
    }

    // Extraer datos validados con tipos garantizados
    const validatedData = requestValidation.data
    const creationSession = sessionValidation.data

    const { username } = validatedData

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
        HTTP_STATUS.BAD_REQUEST
      )
    }

    // PASO 4: Verificar si es un usuario sospechoso (validación de seguridad)
    if (isSuspiciousUsername(username)) {
      const reason = getSuspiciousReason(username)

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
        HTTP_STATUS.BAD_REQUEST
      )
    }

    // PASO 3: Verificar si la cuenta ya fue creada para evitar duplicación
    if (creationSession.accountCreated) {
      return createJsonResponse(
        {
          success: true,
          message: `Account ${username} ${VALIDATION_ERROR_MESSAGES.ACCOUNT_ALREADY_CREATED_SESSION}`,
          verifiedOnChain: true,
          databaseUpdated: true,
          isIdempotent: true,
        },
        HTTP_STATUS.OK
      )
    }

    // PASO 4: Verificación simple de idempotencia (solo existencia de cuenta, ignorando ticket usado)
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
        HTTP_STATUS.OK
      )
    }

    const params = validator.toCreateAccountParams(validatedData)

    // Generar correlation ID para trazabilidad
    const correlationId = `${username}-${Date.now().toString(36)}`
    const obfuscatedTicket = creationSession.ticket
      ? obfuscateTicket(creationSession.ticket)
      : 'N/A'

    // PASO 5: Crear la cuenta en la blockchain
    const transaction = await createAccount(params)

    // PASO 6: Verificar que la cuenta realmente existe usando polling inteligente

    // PASO 7: Operaciones atómicas en base de datos
    const dbResult = await completeAccountCreationInDB(
      username,
      creationSession.ticket,
      correlationId
    )
    if (!dbResult.success) {
      // FALLO CRÍTICO: La cuenta existe on-chain pero falló la DB
      const criticalError = `[${correlationId}] CRITICAL: Account ${username} exists on-chain (tx: ${transaction.id}) but database operations failed: ${dbResult.error}. Manual reconciliation required.`
      const isRace = dbResult.errorCode === ERROR_CODES.TICKET_RACE_CONDITION
      return createJsonResponse(
        {
          success: false,
          message: isRace
            ? VALIDATION_ERROR_MESSAGES.TICKET_ALREADY_IN_USE
            : VALIDATION_ERROR_MESSAGES.DB_OPERATIONS_FAILED,
          error: isRace
            ? VALIDATION_ERROR_MESSAGES.TICKET_ALREADY_IN_USE
            : VALIDATION_ERROR_MESSAGES.DB_OPERATIONS_FAILED,
          details: isRace
            ? VALIDATION_ERROR_MESSAGES.TICKET_RACE_CONDITION
            : dbResult.error,
          transactionId: transaction.id,
          verifiedOnChain: true,
          databaseUpdated: false,
          requiresReconciliation: true,
          correlationId,
          errorCode: dbResult.errorCode || ERROR_CODES.INTERNAL_ERROR,
        },
        isRace ? HTTP_STATUS.CONFLICT : HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }

    // PASO 8: Limpiar la sesión (marcar como completada y limpiar ticket)
    const sessionManager = new CreationSessionManager(
      context.cookies,
      context.request
    )
    sessionManager.set({
      ...creationSession,
      accountCreated: true,
      ticket: undefined, // Limpiar ticket para prevenir reutilización
    })

    // PASO 9: Delegación RC independiente con delay y cache anti-duplicación
    if (!processedUsers.has(username)) {
      processedUsers.add(username)

      // Programar delegación RC después de delay configurado
      setTimeout(async () => {
        try {
          const delegationTransaction = await delegateResourceCredits({
            delegatee: username,
            maxRc: RC_DELEGATION_AMOUNT,
          })
        } catch (delegationError) {
          // La delegación falla pero no afecta la creación de cuenta
        } finally {
          // Programar limpieza del cache
          scheduleUserCleanup(username)
        }
      }, RC_DELEGATION_CONFIG.DELAY_MS)
    }

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
      HTTP_STATUS.OK
    )
  } catch (error) {
    const errMsg =
      error instanceof Error
        ? error.message
        : VALIDATION_ERROR_MESSAGES.FAILED_TO_CREATE_ACCOUNT
    return createJsonResponse(
      {
        success: false,
        message: VALIDATION_ERROR_MESSAGES.UNHANDLED_INTERNAL_ERROR,
        error: errMsg,
        errorCode: ERROR_CODES.INTERNAL_ERROR,
        verifiedOnChain: false,
        databaseUpdated: false,
      },
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
