/**
 * VALIDATION RESULT UTILITIES
 *
 * This file defines a clear pattern for handling validation results
 * that can be successful or contain errors, without mixing with HTTP responses.
 *
 * This makes the code easier to understand and test.
 */

/**
 * Successful result of a validation.
 * Contains the validated data safely typed.
 */
export interface ValidationSuccess<T> {
  readonly success: true
  readonly data: T
}

/**
 * Failed result of a validation.
 * Contains detailed error information for logging and debugging.
 */
export interface ValidationFailure {
  readonly success: false
  readonly error: {
    readonly message: string
    readonly field?: string
    readonly code?: string
  }
}

/**
 * Union type representing the result of any validation.
 *
 * Using this pattern makes control flow clearer:
 * - If success = true, then data is available
 * - If success = false, then error is available
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

/**
 * Helper to create a successful validation result.
 */
export function createValidationSuccess<T>(data: T): ValidationSuccess<T> {
  return { success: true, data }
}

/**
 * Helper to create a failed validation result.
 */
export function createValidationFailure(
  message: string,
  field?: string,
  code?: string
): ValidationFailure {
  return {
    success: false,
    error: { message, field, code },
  }
}

/**
 * Type guard to verify if a validation was successful.
 *
 * Usage example:
 * ```typescript
 * const result = validateSomething(data);
 * if (isValidationSuccess(result)) {
 *   // TypeScript knows that result.data is available
 * } else {
 *   // TypeScript knows that result.error is available
 * }
 * ```
 */
export function isValidationSuccess<T>(
  result: ValidationResult<T>
): result is ValidationSuccess<T> {
  return result.success === true
}

/**
 * Type guard to verify if a validation failed.
 */
export function isValidationFailure<T>(
  result: ValidationResult<T>
): result is ValidationFailure {
  return result.success === false
}
