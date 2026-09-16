/**
 * Validation of promotional ticket codes.
 * Returns null if the ticket is valid; otherwise a descriptive message.
 */

import { TICKET_LENGTH } from '@/consts/constants'

// Specific error messages
const enum TicketMessage {
  NOT_EMPTY = 'El ticket no puede estar vacío.',
  TOO_SHORT = 'El ticket debe tener al menos 10 caracteres.',
  TOO_LONG = 'El ticket debe tener máximo 24 caracteres.',
  INVALID_CHARS = 'El ticket solo puede contener letras y números.',
  ONLY_NUMBERS = 'El ticket no puede ser solo números.',
  INVALID_FORMAT = 'El ticket debe ser una cadena de texto válida.',
}

// Regular expressions (precompiled)
const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]+$/
const ONLY_NUMBERS_REGEX = /^\d+$/

/**
 * Validates the format of a promotional ticket code
 *
 * Rules:
 * - Only letters and numbers (no special characters)
 * - Cannot be only numbers
 * - Can be only letters
 * - Length: 10-24 characters
 * - Type: string
 *
 * @param ticket - Ticket code to validate
 * @returns null if valid, string with error message if invalid
 */
export const validateTicket = (ticket: unknown): string | null => {
  // Verify that it is a string
  if (typeof ticket !== 'string') {
    return TicketMessage.INVALID_FORMAT
  }

  const ticketTrimmed = ticket.trim()

  // Verify that it is not empty
  if (!ticketTrimmed) {
    return TicketMessage.NOT_EMPTY
  }

  // Verify minimum length
  if (ticketTrimmed.length < TICKET_LENGTH.MIN) {
    return TicketMessage.TOO_SHORT
  }

  // Verify maximum length
  if (ticketTrimmed.length > TICKET_LENGTH.MAX) {
    return TicketMessage.TOO_LONG
  }

  // Verify that it only contains letters and numbers
  if (!ALPHANUMERIC_REGEX.test(ticketTrimmed)) {
    return TicketMessage.INVALID_CHARS
  }

  // Verify that it is not only numbers
  if (ONLY_NUMBERS_REGEX.test(ticketTrimmed)) {
    return TicketMessage.ONLY_NUMBERS
  }

  // If we get here, the ticket is valid
  return null
}

/**
 * Cleans and formats a ticket for input
 * Removes special characters and limits length
 *
 * @param ticket - Ticket to clean
 * @returns Clean and formatted ticket
 */
export const cleanTicket = (ticket: string): string => {
  if (!ticket) return ''

  return ticket
    .trim() // Remove whitespace at the start and end
    .replace(/[^a-zA-Z0-9]/g, '') // Remove special characters
    .slice(0, TICKET_LENGTH.MAX) // Limit length
    .toUpperCase() // Convert to uppercase for consistency
}
