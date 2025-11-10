import type { APIContext } from 'astro'
import { type TPublicKey } from '@hiveio/wax'
import { ensureCreation } from '@/lib/session-helpers'
import { USERNAME_CONSTRAINTS, VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import type { ICreateAccountParams } from '@/lib/create/create-account'
import { validateHiveKeySet, type PublicKeySet } from '@/utils/key-validation'
import {
	type ValidationResult,
	createValidationSuccess,
	createValidationFailure
} from '@/utils/validation-result'

export interface ValidatedAccountRequest {
	readonly username: string
	readonly ownerPublicKey: TPublicKey
	readonly activePublicKey: TPublicKey
	readonly postingPublicKey: TPublicKey
	readonly memoPublicKey: TPublicKey
}

export interface ValidatedSession {
	readonly username: string
	readonly ticket?: string
	readonly confirmedDownload: boolean
	readonly accountCreated: boolean
}

/**
 * ACCOUNT CREATION VALIDATOR
 * 
 * Esta clase centraliza toda la lógica de validación para la creación de cuentas Hive.
 * Separa las validaciones en pasos claros y manejables:
 * 
 * 1. validateRequestData() - Valida datos del request (formato, claves)
 * 2. validateSession() - Valida sesión de usuario (descarga confirmada)
 * 3. Conversión a parámetros para crear cuenta
 * 
 * Patron usado: Validation Result Pattern
 * - Retorna ValidationResult<T> en lugar de mezclar con HTTP responses
 * - Hace el código más testeable y fácil de entender
 * - Separa lógica de validación de lógica de HTTP
 */
export class AccountCreationValidator {
	/**
	 * Valida los datos del request de creación de cuenta.
	 * 
	 * Este método valida:
	 * - Campos requeridos están presentes
	 * - Username tiene formato correcto
	 * - Claves públicas son válidas según Hive
	 * 
	 * @param context - Contexto de la petición HTTP
	 * @returns ValidationResult con datos validados o error
	 */
	async validateRequestData(context: APIContext): Promise<ValidationResult<ValidatedAccountRequest>> {
		try {
			const data = await context.request.json()
			const { username, ownerPublicKey, activePublicKey, postingPublicKey, memoPublicKey } = data

			// PASO 1: Validar campos requeridos
			if (!username || !ownerPublicKey || !activePublicKey || !postingPublicKey || !memoPublicKey) {
				return createValidationFailure(
					VALIDATION_ERROR_MESSAGES.MISSING_REQUIRED_FIELDS,
					'request_body',
					'MISSING_REQUIRED_FIELDS'
				)
			}

			// PASO 2: Validar formato de username usando validación básica
			if (
				typeof username !== 'string' ||
				username.length < USERNAME_CONSTRAINTS.MIN_LENGTH ||
				username.length > USERNAME_CONSTRAINTS.MAX_LENGTH
			) {
				return createValidationFailure(
					VALIDATION_ERROR_MESSAGES.INVALID_USERNAME_FORMAT,
					'username',
					'INVALID_USERNAME_FORMAT'
				)
			}

			// Nota: Validación de username contra blockchain se hace en el endpoint principal
			// Este validator solo hace validaciones de formato básicas

			// PASO 3: Validar claves públicas usando type guards seguros
			try {
				const validatedKeys = validateHiveKeySet({
					ownerPublicKey,
					activePublicKey,
					postingPublicKey,
					memoPublicKey,
				})
				
				// Todos los datos son válidos - retornar resultado exitoso
				return createValidationSuccess({
					username,
					...validatedKeys,
				})
			} catch (keyError) {
				const errorMessage = keyError instanceof Error ? keyError.message : 'Key validation failed'
				return createValidationFailure(
					`Invalid public key: ${errorMessage}`,
					'public_keys',
					'INVALID_PUBLIC_KEY_FORMAT'
				)
			}

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown validation error'
			return createValidationFailure(
				`Request validation failed: ${errorMessage}`,
				'request',
				'INTERNAL_ERROR'
			)
		}
	}

	/**
	 * Valida la sesión de creación de cuenta.
	 * 
	 * Verifica que:
	 * - El usuario tiene una sesión activa
	 * - Ha confirmado la descarga de claves
	 * - La sesión es válida para crear cuenta
	 * 
	 * @param context - Contexto de la petición HTTP
	 * @returns ValidationResult con datos de sesión o error
	 */
	async validateSessionData(context: APIContext): Promise<ValidationResult<ValidatedSession>> {
		try {
			// Validar sesión de creación (confirmación de descarga)
			const creationSession = await ensureCreation(context)
			
			if (!creationSession || !creationSession.confirmedDownload) {
				return createValidationFailure(
					VALIDATION_ERROR_MESSAGES.KEYS_DOWNLOAD_NOT_CONFIRMED,
					'session',
					'KEYS_DOWNLOAD_NOT_CONFIRMED'
				)
			}

			return createValidationSuccess(creationSession as ValidatedSession)

		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown session error'
			return createValidationFailure(
				`Session validation failed: ${errorMessage}`,
				'session',
				'INTERNAL_ERROR'
			)
		}
	}

	/**
	 * Convierte datos validados a parámetros de creación de cuenta.
	 * 
	 * Esta función es un simple mapper que convierte el resultado de validación
	 * al formato esperado por la función de creación de cuenta de Hive.
	 * 
	 * @param validatedData - Datos ya validados por validateRequestData()
	 * @returns Parámetros listos para createAccount() de Hive
	 */
	toCreateAccountParams(validatedData: ValidatedAccountRequest): ICreateAccountParams {
		return {
			username: validatedData.username,
			ownerPublicKey: validatedData.ownerPublicKey,
			activePublicKey: validatedData.activePublicKey,
			postingPublicKey: validatedData.postingPublicKey,
			memoPublicKey: validatedData.memoPublicKey,
		}
	}
}