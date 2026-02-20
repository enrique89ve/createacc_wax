/**
 * 🎫 TICKET VALIDATORS
 *
 * Validadores centralizados para tickets.
 * Elimina duplicación de lógica de validación en endpoints.
 */

import type { ValidationResult } from '@/utils/validation-result'
import { MAX_TICKET_CREDITS } from '@/consts/constants'

// Constantes de validación
const MIN_TICKET_LENGTH = 10
const MAX_TICKET_LENGTH = 24
const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]+$/
const ONLY_NUMBERS_REGEX = /^\d+$/

const MIN_TICKET_CREDITS = 1

/**
 * Validar nombre de ticket
 *
 * Reglas:
 * - No vacío
 * - Entre 10 y 24 caracteres
 * - Solo letras y números
 * - No puede ser solo números
 *
 * @param name - Nombre del ticket a validar
 * @returns ValidationResult con string normalizado o error
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
		data: trimmedName.toUpperCase(), // Normalizado a mayúsculas
	}
}

/**
 * Validar cantidad de créditos para ticket
 *
 * @param credits - Cantidad de créditos a validar (puede ser any)
 * @returns ValidationResult con número validado o error
 *
 * Reglas:
 * - Debe ser un número
 * - Entre 1 y MAX_TICKET_CREDITS (100)
 * - Debe ser entero
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
 * Validar delta de actualización de créditos
 *
 * @param currentCredits - Créditos actuales del ticket
 * @param delta - Cambio a aplicar (positivo o negativo)
 * @returns ValidationResult con delta y nuevos créditos calculados
 *
 * Reglas:
 * - Debe ser un número
 * - No puede ser cero
 * - Debe ser entero
 * - Los nuevos créditos deben estar en rango válido
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
 * Validar descripción de ticket (opcional)
 *
 * @param description - Descripción del ticket
 * @returns ValidationResult con string trimmed o null
 */
export function validateTicketDescription(
	description: unknown
): ValidationResult<string | null> {
	// Descripción es opcional
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

	// Descripción vacía es válida (se guarda como null)
	if (trimmed.length === 0) {
		return {
			success: true,
			data: null,
		}
	}

	// Límite razonable para descripción
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
 * Exportar constantes para uso externo
 */
export const TICKET_VALIDATION_CONSTANTS = {
	MIN_TICKET_LENGTH,
	MAX_TICKET_LENGTH,
	MIN_TICKET_CREDITS,
	MAX_TICKET_CREDITS,
	ALPHANUMERIC_REGEX,
	ONLY_NUMBERS_REGEX,
} as const
