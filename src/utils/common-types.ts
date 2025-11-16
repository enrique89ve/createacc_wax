/**
 * COMMON TYPES - Utility types unificados para /utils
 *
 * Este archivo centraliza los patrones de tipos comunes para eliminar duplicación
 * y garantizar consistencia en todo el directorio /utils.
 *
 * Creado para estandarización TypeScript - Mejoras de Prioridad Alta
 */

// ===== RESULT PATTERNS =====

/**
 * Tipo genérico unificado para operaciones que pueden fallar
 * Reemplaza las múltiples interfaces similares en diferentes archivos
 */
export type Result<T, E = string> =
  | { success: true; data: T }
  | { success: false; error: E }

/**
 * Especializaciones para casos de uso específicos
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
 * Para validaciones de entrada de usuario
 */
export type ValidationResult<T> = Result<T, ValidationError>

/**
 * Para operaciones de base de datos
 */
export type DatabaseResult<T> = Result<T, DatabaseError>

/**
 * Para operaciones de API
 */
export type ApiResult<T> = Result<T, OperationError>

/**
 * Para operaciones síncronas simples
 */
export type SyncResult<T> = Result<T, string>

// ===== HELPER FUNCTIONS =====

/**
 * Helper para crear resultado exitoso
 */
export const success = <T>(data: T): Result<T, never> => ({
  success: true,
  data,
})

/**
 * Helper para crear resultado fallido
 */
export const failure = <E>(error: E): Result<never, E> => ({
  success: false,
  error,
})

/**
 * Helper para crear error de validación
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
 * Helper para crear error de base de datos
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
 * Type guard para verificar si un resultado fue exitoso
 */
export const isSuccess = <T, E>(
  result: Result<T, E>
): result is { success: true; data: T } => result.success === true

/**
 * Type guard para verificar si un resultado falló
 */
export const isFailure = <T, E>(
  result: Result<T, E>
): result is { success: false; error: E } => result.success === false

/**
 * Type guard para ValidationResult exitoso
 */
export const isValidationSuccess = <T>(
  result: ValidationResult<T>
): result is { success: true; data: T } => result.success === true

/**
 * Type guard para ValidationResult fallido
 */
export const isValidationFailure = <T>(
  result: ValidationResult<T>
): result is { success: false; error: ValidationError } =>
  result.success === false

// ===== INPUT VALIDATION TYPES =====

/**
 * Tipo base para entradas que requieren validación
 */
export type UnknownInput = unknown

/**
 * Tipo para inputs de string que necesitan validación
 */
export type StringInput = unknown

/**
 * Tipo para inputs numéricos que necesitan validación
 */
export type NumberInput = unknown

// ===== COMMON INTERFACES =====

/**
 * Interface para objetos que tienen timestamp
 */
export interface Timestamped {
  readonly timestamp: string
}

/**
 * Interface para objetos que tienen ID
 */
export interface WithId<T = string | number> {
  readonly id: T
}

/**
 * Interface para objetos que pueden ser auditados
 */
export interface Auditable {
  readonly createdAt: string
  readonly updatedAt?: string
  readonly createdBy?: string | number
}

// (Se eliminaron tipos y helpers legacy no utilizados para mantener el código limpio)
