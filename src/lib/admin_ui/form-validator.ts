/**
 * FormValidator - Validaciones compartidas para formularios
 * Utilizado en management y builders portals
 */

import { BUILDERS_UI } from '@/consts/constants'

export const FormValidator = {
  /**
   * Valida username (3-20 caracteres alfanuméricos, guiones, guiones bajos)
   */
  validateUsername(username: string): boolean {
    const usernameRegex = /^[a-zA-Z0-9_-]{3,20}$/
    return usernameRegex.test(username)
  },

  /**
   * Valida password (mínimo 8 caracteres)
   */
  validatePassword(password: string): boolean {
    return password.length >= 8
  },

  /**
   * Valida nombre de ticket
   * Retorna mensaje de error si es inválido, null si es válido
   */
  validateTicketName(name: string): string | null {
    if (!name || name.trim().length === 0) {
      return BUILDERS_UI.MESSAGES.TICKET_NAME_REQUIRED
    }

    if (name.length < BUILDERS_UI.TICKET_VALIDATION.MIN_LENGTH) {
      return `${BUILDERS_UI.MESSAGES.MIN_LENGTH_ERROR} ${BUILDERS_UI.TICKET_VALIDATION.MIN_LENGTH} caracteres`
    }

    if (name.length > BUILDERS_UI.TICKET_VALIDATION.MAX_LENGTH) {
      return `${BUILDERS_UI.MESSAGES.MAX_LENGTH_ERROR} ${BUILDERS_UI.TICKET_VALIDATION.MAX_LENGTH} caracteres`
    }

    if (BUILDERS_UI.TICKET_VALIDATION.ONLY_NUMBERS_REGEX.test(name)) {
      return BUILDERS_UI.MESSAGES.ONLY_NUMBERS
    }

    return null
  },

  /**
   * Valida cantidad de créditos
   */
  validateCredits(amount: number, min: number, max: number): boolean {
    return amount >= min && amount <= max && Number.isInteger(amount)
  },

  /**
   * Valida que un campo no esté vacío
   */
  validateRequired(value: string): boolean {
    return value.trim().length > 0
  },

  /**
   * Valida email básico
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  },
}
