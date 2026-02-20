import { type TPublicKey } from '@hiveio/wax'
import { USERNAME_CONSTRAINTS, VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import type { ICreateAccountParams } from '@/lib/create/create-account'
import { validateHiveKeySet } from '@/utils/key-validation'
import type { CreationSession } from '@/types/auth'
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
	readonly ticket: string
	readonly confirmedDownload: boolean
	readonly accountCreated: boolean
}

/**
 * Valida los datos del request de creacion de cuenta (funcion pura).
 *
 * Valida: campos requeridos, formato de username, claves publicas validas.
 */
export function validateRequestData(
	data: Record<string, unknown>
): ValidationResult<ValidatedAccountRequest> {
	const { username, ownerPublicKey, activePublicKey, postingPublicKey, memoPublicKey } = data

	if (!username || !ownerPublicKey || !activePublicKey || !postingPublicKey || !memoPublicKey) {
		return createValidationFailure(
			VALIDATION_ERROR_MESSAGES.MISSING_REQUIRED_FIELDS,
			'request_body',
			'MISSING_REQUIRED_FIELDS'
		)
	}

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

	try {
		const validatedKeys = validateHiveKeySet({
			ownerPublicKey,
			activePublicKey,
			postingPublicKey,
			memoPublicKey,
		})

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
}

/**
 * Valida la sesion de creacion de cuenta (funcion pura).
 *
 * Verifica: sesion activa, descarga confirmada, username match, ticket presente.
 */
export function validateSessionData(
	session: CreationSession | null,
	requestUsername: string
): ValidationResult<ValidatedSession> {
	if (!session || !session.confirmedDownload) {
		return createValidationFailure(
			VALIDATION_ERROR_MESSAGES.KEYS_DOWNLOAD_NOT_CONFIRMED,
			'session',
			'KEYS_DOWNLOAD_NOT_CONFIRMED'
		)
	}

	if (session.username !== requestUsername) {
		return createValidationFailure(
			VALIDATION_ERROR_MESSAGES.USERNAME_SESSION_MISMATCH,
			'username',
			'USERNAME_SESSION_MISMATCH'
		)
	}

	if (!session.ticket || !session.ticket.trim()) {
		return createValidationFailure(
			VALIDATION_ERROR_MESSAGES.TICKET_REQUIRED,
			'ticket',
			'TICKET_REQUIRED'
		)
	}

	return createValidationSuccess({
		username: session.username,
		ticket: session.ticket,
		confirmedDownload: session.confirmedDownload ?? false,
		accountCreated: session.accountCreated ?? false,
	} satisfies ValidatedSession)
}

/**
 * Convierte datos validados a parametros de creacion de cuenta.
 */
export function toCreateAccountParams(validatedData: ValidatedAccountRequest): ICreateAccountParams {
	return {
		username: validatedData.username,
		ownerPublicKey: validatedData.ownerPublicKey,
		activePublicKey: validatedData.activePublicKey,
		postingPublicKey: validatedData.postingPublicKey,
		memoPublicKey: validatedData.memoPublicKey,
	}
}
