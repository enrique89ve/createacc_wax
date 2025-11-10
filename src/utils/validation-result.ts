/**
 * VALIDATION RESULT UTILITIES
 * 
 * Este archivo define un patrón claro para manejar resultados de validación
 * que pueden ser exitosos o contener errores, sin mezclar con HTTP responses.
 * 
 * Esto hace el código más fácil de entender y testear.
 */

/**
 * Resultado exitoso de una validación.
 * Contiene los datos validados y tipados de forma segura.
 */
export interface ValidationSuccess<T> {
	readonly success: true
	readonly data: T
}

/**
 * Resultado fallido de una validación.
 * Contiene información detallada del error para logging y debugging.
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
 * Tipo union que representa el resultado de cualquier validación.
 * 
 * Usar este patrón hace el flujo de control más claro:
 * - Si success = true, entonces data está disponible
 * - Si success = false, entonces error está disponible
 */
export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

/**
 * Helper para crear un resultado exitoso de validación.
 */
export function createValidationSuccess<T>(data: T): ValidationSuccess<T> {
	return { success: true, data }
}

/**
 * Helper para crear un resultado fallido de validación.
 */
export function createValidationFailure(
	message: string,
	field?: string,
	code?: string
): ValidationFailure {
	return {
		success: false,
		error: { message, field, code }
	}
}

/**
 * Type guard para verificar si una validación fue exitosa.
 * 
 * Ejemplo de uso:
 * ```typescript
 * const result = validateSomething(data);
 * if (isValidationSuccess(result)) {
 *   // TypeScript sabe que result.data está disponible
 * } else {
 *   // TypeScript sabe que result.error está disponible
 * }
 * ```
 */
export function isValidationSuccess<T>(
	result: ValidationResult<T>
): result is ValidationSuccess<T> {
	return result.success === true
}

/**
 * Type guard para verificar si una validación falló.
 */
export function isValidationFailure<T>(
	result: ValidationResult<T>
): result is ValidationFailure {
	return result.success === false
}