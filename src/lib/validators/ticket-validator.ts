/**
 * 🎫 TICKET VALIDATORS
 *
 * Centralized ticket validators.
 * Eliminates duplicate validation logic in endpoints.
 */

import type { ValidationResult } from '@/utils/validation-result'
import { MAX_TICKET_USES, TICKET_LENGTH } from '@/consts/constants'
const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]+$/
const ONLY_NUMBERS_REGEX = /^\d+$/

const MIN_TICKET_USES = 1

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
export function validateTicketName(name: unknown): ValidationResult<string> {
  if (typeof name !== 'string' || !name.trim()) {
    return {
      success: false,
      error: {
        message: 'El nombre del ticket no puede estar vacío',
        field: 'code',
      },
    }
  }

  const trimmedName = name.trim()

  if (trimmedName.length < TICKET_LENGTH.MIN) {
    return {
      success: false,
      error: {
        message: `El nombre debe tener al menos ${TICKET_LENGTH.MIN} caracteres`,
        field: 'code',
      },
    }
  }

  if (trimmedName.length > TICKET_LENGTH.MAX) {
    return {
      success: false,
      error: {
        message: `El nombre no puede exceder ${TICKET_LENGTH.MAX} caracteres`,
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
 * Validate uses quantity for ticket
 *
 * @param uses - Uses quantity to validate (can be any)
 * @returns ValidationResult with validated number or error
 *
 * Rules:
 * - Must be a number
 * - Between 1 and MAX_TICKET_USES (100)
 * - Must be an integer
 */
export function validateTicketUses(uses: unknown): ValidationResult<number> {
  if (typeof uses !== 'number') {
    return {
      success: false,
      error: {
        message: 'Los usos deben ser un número',
        field: 'uses',
      },
    }
  }

  if (!Number.isInteger(uses)) {
    return {
      success: false,
      error: {
        message: 'Los usos deben ser un número entero',
        field: 'uses',
      },
    }
  }

  if (uses < MIN_TICKET_USES) {
    return {
      success: false,
      error: {
        message: `Los usos deben ser al menos ${MIN_TICKET_USES}`,
        field: 'uses',
      },
    }
  }

  if (uses > MAX_TICKET_USES) {
    return {
      success: false,
      error: {
        message: `Los usos no pueden exceder ${MAX_TICKET_USES}`,
        field: 'uses',
      },
    }
  }

  return {
    success: true,
    data: uses,
  }
}

/**
 * Validate uses update delta
 *
 * @param currentUses - Current uses of the ticket
 * @param delta - Change to apply (positive or negative)
 * @returns ValidationResult with delta and newly calculated uses
 *
 * Rules:
 * - Must be a number
 * - Cannot be zero
 * - Must be an integer
 * - New uses must be in valid range
 */
export function validateUsesDelta(
  currentUses: number,
  delta: unknown,
  originalUses: number = currentUses
): ValidationResult<{ delta: number; newUses: number }> {
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

  const newUses = currentUses + delta
  const newOriginalUses = originalUses + delta

  if (newUses < 0) {
    return {
      success: false,
      error: {
        message: 'Los usos restantes no pueden ser negativos',
        field: 'delta',
      },
    }
  }

  if (newUses > MAX_TICKET_USES) {
    return {
      success: false,
      error: {
        message: `Los usos no pueden exceder ${MAX_TICKET_USES}`,
        field: 'delta',
      },
    }
  }

  if (newOriginalUses > MAX_TICKET_USES) {
    return {
      success: false,
      error: {
        message: `El total de usos no puede exceder ${MAX_TICKET_USES}`,
        field: 'delta',
      },
    }
  }

  if (newOriginalUses < MIN_TICKET_USES) {
    return {
      success: false,
      error: {
        message: `El total de usos debe ser al menos ${MIN_TICKET_USES}`,
        field: 'delta',
      },
    }
  }

  if (newOriginalUses < newUses) {
    return {
      success: false,
      error: {
        message: 'El total de usos no puede ser menor que los restantes',
        field: 'delta',
      },
    }
  }

  return {
    success: true,
    data: { delta, newUses },
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
  MIN_TICKET_LENGTH: TICKET_LENGTH.MIN,
  MAX_TICKET_LENGTH: TICKET_LENGTH.MAX,
  MIN_TICKET_USES,
  MAX_TICKET_USES,
  ALPHANUMERIC_REGEX,
  ONLY_NUMBERS_REGEX,
} as const
