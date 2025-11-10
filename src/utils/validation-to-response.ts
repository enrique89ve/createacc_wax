/**
 * VALIDATION TO HTTP RESPONSE ADAPTER
 *
 * Este archivo contiene utilities para convertir ValidationResult a HTTP Response.
 * Mantiene la separación entre lógica de validación y lógica HTTP.
 *
 * Patrón usado: Adapter Pattern
 * - ValidationResult es para lógica interna (testeable)
 * - Response es para HTTP (framework específico)
 */

import type { ValidationFailure } from '@/utils/validation-result'
import { createJsonResponse } from '@/utils/errorResponse'
import { HTTP_STATUS } from '@/consts/constants'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { DATABASE_ERROR_CODES } from '@/consts/unified-errors'

/**
 * Mapeo de códigos de error interno a códigos HTTP apropiados.
 *
 * Esto centraliza la lógica de qué errores de validación
 * corresponden a qué códigos de estado HTTP.
 */
const ERROR_CODE_TO_HTTP_STATUS: Record<string, number> = {
  MISSING_REQUIRED_FIELDS: HTTP_STATUS.BAD_REQUEST,
  INVALID_USERNAME_FORMAT: HTTP_STATUS.BAD_REQUEST,
  INVALID_PUBLIC_KEY_FORMAT: HTTP_STATUS.BAD_REQUEST,
  KEYS_DOWNLOAD_NOT_CONFIRMED: HTTP_STATUS.BAD_REQUEST,
  INTERNAL_ERROR: HTTP_STATUS.INTERNAL_SERVER_ERROR,
}

/**
 * Mapeo de códigos de error interno a mensajes de error detallados.
 *
 * Permite tener mensajes específicos para cada tipo de error
 * sin repetir lógica en múltiples lugares.
 */
const ERROR_CODE_TO_DETAILED_MESSAGE: Record<string, string> = {
  MISSING_REQUIRED_FIELDS:
    VALIDATION_ERROR_MESSAGES.MISSING_REQUIRED_FIELDS_DETAILED,
  KEYS_DOWNLOAD_NOT_CONFIRMED:
    VALIDATION_ERROR_MESSAGES.KEYS_DOWNLOAD_NOT_CONFIRMED_DETAILED,
}

/**
 * Convierte un ValidationFailure a una HTTP Response apropiada.
 *
 * Esta función toma el error de validación genérico y lo convierte
 * al formato específico que espera el frontend de HolaHive.
 *
 * @param failure - El resultado fallido de validación
 * @returns Response HTTP con formato estándar de error
 *
 * Ejemplo de uso:
 * ```typescript
 * const result = await validator.validateRequestData(context);
 * if (!isValidationSuccess(result)) {
 *   return validationFailureToResponse(result);
 * }
 * ```
 */
export function validationFailureToResponse(
  failure: ValidationFailure
): Response {
  const { error } = failure

  // Determinar código de estado HTTP basado en el tipo de error
  const httpStatus = error.code
    ? ERROR_CODE_TO_HTTP_STATUS[error.code] || HTTP_STATUS.BAD_REQUEST
    : HTTP_STATUS.BAD_REQUEST

  // Obtener mensaje detallado si existe
  const detailedMessage = error.code
    ? ERROR_CODE_TO_DETAILED_MESSAGE[error.code]
    : undefined

  // Crear response con formato estándar de HolaHive
  return createJsonResponse(
    {
      success: false,
      message: error.message,
      error: detailedMessage || error.message,
      ...(error.field && { field: error.field }),
      errorCode: DATABASE_ERROR_CODES.INTERNAL_ERROR, // Compatibilidad con sistema existente
      verifiedOnChain: false,
      databaseUpdated: false,
    },
    httpStatus
  )
}
