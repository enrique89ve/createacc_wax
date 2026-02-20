/**
 * 🎫 TICKET VALIDATORS
 *
 * Centralized ticket validators.
 * Eliminates duplicate validation logic in endpoints.
 */

import type { ValidationResult } from '@/utils/validation-result'
import { MAX_TICKET_CREDITS } from '@/consts/constants'

// Validation constants
const MIN_TICKET_LENGTH = 10
const MAX_TICKET_LENGTH = 24
const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]+$/
const ONLY_NUMBERS_REGEX = /^\d+$/

const MIN_TICKET_CREDITS = 1

/**
 * Validate ticket name
 *
 * Rules:
 * - Not empty
 * - Between 10 and 24 characters
 * - Only letters and numbers
 * - Cannot be only numbers
 *
 * @param name - Ticket name to validate
 * @returns ValidationResult with normalized string or error
 */
export function validateTicketName(name: string): ValidationResult<string> {
	if (!name || !name.trim()) {
		return {
			success: false,
			error: {
				message: 'El nombre del ticket no puede estar vacío',
				field: 'code',
			},
		}
	}

	const trimmedName = name.trim()

	if (trimmedName.length < MIN_TICKET_LENGTH) {
		return {
			success: false,
			error: {
				message: `El nombre debe tener al menos ${MIN_TICKET_LENGTH} caracteres`,
				field: 'code',
			},
		}
	}

	if (trimmedName.length > MAX_TICKET_LENGTH) {
		return {
			success: false,
			error: {
				message: `El nombre no puede exceder ${MAX_TICKET_LENGTH} caracteres`,
				field: 'code',
			},
		}
	}

	if (!ALPHANUMERIC_REGEX.test(trimmedName)) {
		return {
			success: false,
			error: {
				message: 'El nombre solo puede contener letras y números',
				field: 'code',
			},
		}
	}

	if (ONLY_NUMBERS_REGEX.test(trimmedName)) {
		return {
			success: false,
			error: {
				message: 'El nombre no puede ser solo números',
				field: 'code',
			},
		}
	}

	return {
		success: true,
		data: trimmedName.toUpperCase(), // Normalized to uppercase
	}
}

/**
 * Validate credits quantity for ticket
 *
 * @param credits - Credits quantity to validate (can be any)
 * @returns ValidationResult with validated number or error
 *
 * Rules:
 * - Must be a number
 * - Between 1 and MAX_TICKET_CREDITS (100)
 * - Must be an integer
 */
export function validateTicketCredits(
	credits: unknown
): ValidationResult<number> {
	if (typeof credits !== 'number') {
		return {
			success: false,
			error: {
				message: 'Los créditos deben ser un número',
				field: 'credits',
			},
		}
	}

	if (!Number.isInteger(credits)) {
		return {
			success: false,
			error: {
				message: 'Los créditos deben ser un número entero',
				field: 'credits',
			},
		}
	}

	if (credits < MIN_TICKET_CREDITS) {
		return {
			success: false,
			error: {
				message: `Los créditos deben ser al menos ${MIN_TICKET_CREDITS}`,
				field: 'credits',
			},
		}
	}

	if (credits > MAX_TICKET_CREDITS) {
		return {
			success: false,
			error: {
				message: `Los créditos no pueden exceder ${MAX_TICKET_CREDITS}`,
				field: 'credits',
			},
		}
	}

	return {
		success: true,
		data: credits,
	}
}

/**
 * Validate credits update delta
 *
 * @param currentCredits - Current credits of the ticket
 * @param delta - Change to apply (positive or negative)
 * @returns ValidationResult with delta and newly calculated credits
 *
 * Rules:
 * - Must be a number
 * - Cannot be zero
 * - Must be an integer
 * - New credits must be in valid range
 */
export function validateCreditsDelta(
	currentCredits: number,
	delta: unknown
): ValidationResult<{ delta: number; newCredits: number }> {
	if (typeof delta !== 'number') {
		return {
			success: false,
			error: {
				message: 'El delta debe ser un número',
				field: 'delta',
			},
		}
	}

	if (!Number.isInteger(delta)) {
		return {
			success: false,
			error: {
				message: 'El delta debe ser un número entero',
				field: 'delta',
			},
		}
	}

	if (delta === 0) {
		return {
			success: false,
			error: {
				message: 'El delta no puede ser cero',
				field: 'delta',
			},
		}
	}

	const newCredits = currentCredits + delta

	if (newCredits < MIN_TICKET_CREDITS) {
		return {
			success: false,
			error: {
				message: 'Debe quedar al menos 1 crédito en el ticket',
				field: 'delta',
			},
		}
	}

	if (newCredits > MAX_TICKET_CREDITS) {
		return {
			success: false,
			error: {
				message: `Los créditos no pueden exceder ${MAX_TICKET_CREDITS}`,
				field: 'delta',
			},
		}
	}

	return {
		success: true,
		data: { delta, newCredits },
	}
}

/**
 * Validate ticket description (optional)
 *
 * @param description - Ticket description
 * @returns ValidationResult with trimmed string or null
 */
export function validateTicketDescription(
	description: unknown
): ValidationResult<string | null> {
	// Description is optional
	if (description === undefined || description === null) {
		return {
			success: true,
			data: null,
		}
	}

	if (typeof description !== 'string') {
		return {
			success: false,
			error: {
				message: 'La descripción debe ser texto',
				field: 'description',
			},
		}
	}

	const trimmed = description.trim()

	// Empty description is valid (saved as null)
	if (trimmed.length === 0) {
		return {
			success: true,
			data: null,
		}
	}

	// Reasonable limit for description
	if (trimmed.length > 200) {
		return {
			success: false,
			error: {
				message: 'La descripción no puede exceder 200 caracteres',
				field: 'description',
			},
		}
	}

	return {
		success: true,
		data: trimmed,
	}
}

/**
 * Export constants for external use
 */
export const TICKET_VALIDATION_CONSTANTS = {
	MIN_TICKET_LENGTH,
	MAX_TICKET_LENGTH,
	MIN_TICKET_CREDITS,
	MAX_TICKET_CREDITS,
	ALPHANUMERIC_REGEX,
	ONLY_NUMBERS_REGEX,
} as const
