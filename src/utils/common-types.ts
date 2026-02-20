/**
 * COMMON TYPES - Unified utility types for /utils
 *
 * This file centralizes common type patterns to eliminate duplication
 * and guarantee consistency across the /utils directory.
 *
 * Created for TypeScript standardization - High Priority Improvements
 */

// ===== RESULT PATTERNS =====

/**
 * Unified generic type for operations that can fail
 * Replaces the multiple similar interfaces in different files
 */
export type Result<T, E = string> =
  | { success: true; data: T }
  | { success: false; error: E }

/**
 * Specializations for specific use cases
 */
export interface ValidationError {
  readonly message: string
  readonly field?: string
  readonly code?: string
}

export interface OperationError {
  readonly message: string
  readonly code?: string
  readonly correlationId?: string
}

export interface DatabaseError extends OperationError {
  readonly sqlError?: unknown
  readonly query?: string
}

// ===== SPECIALIZED RESULT TYPES =====

/**
 * For user input validations
 */
export type ValidationResult<T> = Result<T, ValidationError>

/**
 * For database operations
 */
export type DatabaseResult<T> = Result<T, DatabaseError>

/**
 * For API operations
 */
export type ApiResult<T> = Result<T, OperationError>

/**
 * For simple synchronous operations
 */
export type SyncResult<T> = Result<T, string>

// ===== HELPER FUNCTIONS =====

/**
 * Helper to create successful result
 */
export const success = <T>(data: T): Result<T, never> => ({
  success: true,
  data,
})

/**
 * Helper to create failed result
 */
export const failure = <E>(error: E): Result<never, E> => ({
  success: false,
  error,
})

/**
 * Helper to create validation error
 */
export const validationFailure = (
  message: string,
  field?: string,
  code?: string
): ValidationResult<never> => ({
  success: false,
  error: { message, field, code },
})

/**
 * Helper to create database error
 */
export const databaseFailure = (
  message: string,
  code?: string,
  correlationId?: string,
  sqlError?: unknown
): DatabaseResult<never> => ({
  success: false,
  error: { message, code, correlationId, sqlError },
})

// ===== TYPE GUARDS =====

/**
 * Type guard to check if a result was successful
 */
export const isSuccess = <T, E>(
  result: Result<T, E>
): result is { success: true; data: T } => result.success === true

/**
 * Type guard to check if a result failed
 */
export const isFailure = <T, E>(
  result: Result<T, E>
): result is { success: false; error: E } => result.success === false

/**
 * Type guard for successful ValidationResult
 */
export const isValidationSuccess = <T>(
  result: ValidationResult<T>
): result is { success: true; data: T } => result.success === true

/**
 * Type guard for failed ValidationResult
 */
export const isValidationFailure = <T>(
  result: ValidationResult<T>
): result is { success: false; error: ValidationError } =>
  result.success === false

// ===== INPUT VALIDATION TYPES =====

/**
 * Base type for inputs that require validation
 */
export type UnknownInput = unknown

/**
 * Type for string inputs that need validation
 */
export type StringInput = unknown

/**
 * Type for numeric inputs that need validation
 */
export type NumberInput = unknown

// ===== COMMON INTERFACES =====

/**
 * Interface for objects that have a timestamp
 */
export interface Timestamped {
  readonly timestamp: string
}

/**
 * Interface for objects that have an ID
 */
export interface WithId<T = string | number> {
  readonly id: T
}

/**
 * Interface for objects that can be audited
 */
export interface Auditable {
  readonly createdAt: string
  readonly updatedAt?: string
  readonly createdBy?: string | number
}

// (Removed unused legacy types and helpers to keep the code clean)
