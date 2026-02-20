/**
 * VALIDATION TO HTTP RESPONSE ADAPTER
 *
 * This file contains utilities to convert ValidationResult to an HTTP Response.
 * Maintains the separation between validation logic and HTTP logic.
 *
 * Pattern used: Adapter Pattern
 * - ValidationResult is for internal logic (testable)
 * - Response is for HTTP (framework specific)
 */

import type { ValidationFailure } from '@/utils/validation-result'
import { createJsonResponse } from '@/utils/errorResponse'
import { HTTP_STATUS } from '@/consts/constants'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { ALL_ERROR_CODES, DATABASE_ERROR_CODES, type UnifiedErrorCode } from '@/consts/unified-errors'

/**
 * Mapping of internal error codes to appropriate HTTP status codes.
 *
 * This centralizes the logic of which validation errors
 * correspond to which HTTP status codes.
 */
const ERROR_CODE_TO_HTTP_STATUS: Record<string, number> = {
  MISSING_REQUIRED_FIELDS: HTTP_STATUS.BAD_REQUEST,
  INVALID_USERNAME_FORMAT: HTTP_STATUS.BAD_REQUEST,
  INVALID_PUBLIC_KEY_FORMAT: HTTP_STATUS.BAD_REQUEST,
  KEYS_DOWNLOAD_NOT_CONFIRMED: HTTP_STATUS.BAD_REQUEST,
  INTERNAL_ERROR: HTTP_STATUS.INTERNAL_SERVER_ERROR,
}

/**
 * Mapping of internal error codes to detailed error messages.
 *
 * Allows having specific messages for each error type
 * without repeating logic in multiple places.
 */
const ERROR_CODE_TO_DETAILED_MESSAGE: Record<string, string> = {
  MISSING_REQUIRED_FIELDS:
    VALIDATION_ERROR_MESSAGES.MISSING_REQUIRED_FIELDS_DETAILED,
  KEYS_DOWNLOAD_NOT_CONFIRMED:
    VALIDATION_ERROR_MESSAGES.KEYS_DOWNLOAD_NOT_CONFIRMED_DETAILED,
}

/**
 * Converts a ValidationFailure to an appropriate HTTP Response.
 *
 * This function takes the generic validation error and converts it
 * to the specific format expected by the frontend.
 *
 * @param failure - The failed validation result
 * @returns HTTP Response with standard error format
 *
 * Usage example:
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

  // Determine HTTP status code based on error type
  const httpStatus = error.code
    ? ERROR_CODE_TO_HTTP_STATUS[error.code] || HTTP_STATUS.BAD_REQUEST
    : HTTP_STATUS.BAD_REQUEST

  // Get detailed message if exists
  const detailedMessage = error.code
    ? ERROR_CODE_TO_DETAILED_MESSAGE[error.code]
    : undefined

  // Map the validation error code to a unified error code.
  // Falls back to INTERNAL_ERROR only when the code is unknown.
  const allCodes = ALL_ERROR_CODES as Record<string, UnifiedErrorCode>
  const errorCode: UnifiedErrorCode = (error.code && allCodes[error.code])
    ? allCodes[error.code]
    : DATABASE_ERROR_CODES.INTERNAL_ERROR

  // Create response with standard frontend format
  return createJsonResponse(
    {
      success: false,
      message: error.message,
      error: detailedMessage || error.message,
      ...(error.field && { field: error.field }),
      errorCode,
      verifiedOnChain: false,
      databaseUpdated: false,
    },
    httpStatus,
    { noCache: true }
  )
}
