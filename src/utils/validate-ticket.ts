/**
 * Validación de códigos de ticket promocionales.
 * Retorna null si el ticket es válido; de lo contrario un mensaje descriptivo.
 */

// Constantes de validación
const MIN_TICKET_LENGTH = 4 as const
const MAX_TICKET_LENGTH = 24 as const

// Mensajes de error específicos
const enum TicketMessage {
  NOT_EMPTY = 'El ticket no puede estar vacío.',
  TOO_SHORT = 'El ticket debe tener al menos 4 caracteres.',
  TOO_LONG = 'El ticket debe tener máximo 24 caracteres.',
  INVALID_CHARS = 'El ticket solo puede contener letras y números.',
  ONLY_NUMBERS = 'El ticket no puede ser solo números.',
  INVALID_FORMAT = 'El ticket debe ser una cadena de texto válida.',
}

// Expresiones regulares (precompiladas)
const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]+$/
const ONLY_NUMBERS_REGEX = /^\d+$/

/**
 * Valida el formato de un código de ticket promocional
 *
 * Reglas:
 * - Solo letras y números (sin caracteres especiales)
 * - No puede ser solo números
 * - Puede ser solo letras
 * - Longitud: 4-24 caracteres
 * - Tipo: string
 *
 * @param ticket - Código de ticket a validar
 * @returns null si es válido, string con mensaje de error si no es válido
 */
export const validateTicket = (ticket: unknown): string | null => {
  // Verificar que sea string
  if (typeof ticket !== 'string') {
    return TicketMessage.INVALID_FORMAT
  }

  const ticketTrimmed = ticket.trim()

  // Verificar que no esté vacío
  if (!ticketTrimmed) {
    return TicketMessage.NOT_EMPTY
  }

  // Verificar longitud mínima
  if (ticketTrimmed.length < MIN_TICKET_LENGTH) {
    return TicketMessage.TOO_SHORT
  }

  // Verificar longitud máxima
  if (ticketTrimmed.length > MAX_TICKET_LENGTH) {
    return TicketMessage.TOO_LONG
  }

  // Verificar que solo contenga letras y números
  if (!ALPHANUMERIC_REGEX.test(ticketTrimmed)) {
    return TicketMessage.INVALID_CHARS
  }

  // Verificar que no sea solo números
  if (ONLY_NUMBERS_REGEX.test(ticketTrimmed)) {
    return TicketMessage.ONLY_NUMBERS
  }

  // Si llegamos aquí, el ticket es válido
  return null
}

/**
 * Limpia y formatea un ticket para input
 * Elimina caracteres especiales y limita la longitud
 *
 * @param ticket - Ticket a limpiar
 * @returns Ticket limpio y formateado
 */
export const cleanTicket = (ticket: string): string => {
  if (!ticket) return ''

  return ticket
    .trim() // Eliminar espacios en blanco al inicio y final
    .replace(/[^a-zA-Z0-9]/g, '') // Eliminar caracteres especiales
    .slice(0, MAX_TICKET_LENGTH) // Limitar longitud
    .toUpperCase() // Convertir a mayúsculas para consistencia
}

/**
 * Verifica si un ticket es válido (función de conveniencia)
 *
 * @param ticket - Ticket a verificar
 * @returns true si es válido, false si no
 */
export const isValidTicket = (ticket: unknown): boolean => {
  return validateTicket(ticket) === null
}
