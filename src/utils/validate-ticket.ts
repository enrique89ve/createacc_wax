/**
 * Access-code format codes for the public UI.
 * Internal ticket rules stay the same; UI copy lives in i18n dictionaries.
 */

import { TICKET_LENGTH } from '@/consts/constants'

export const ACCESS_CODE_FORMAT_CODES = [
  'empty',
  'tooShort',
  'tooLong',
  'invalidChars',
  'onlyNumbers',
  'invalidFormat',
] as const

export type AccessCodeFormatCode = (typeof ACCESS_CODE_FORMAT_CODES)[number]

const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]+$/
const ONLY_NUMBERS_REGEX = /^\d+$/

export const validateTicket = (
  ticket: unknown
): AccessCodeFormatCode | null => {
  if (typeof ticket !== 'string') return 'invalidFormat'
  const ticketTrimmed = ticket.trim()
  if (!ticketTrimmed) return 'empty'
  if (ticketTrimmed.length < TICKET_LENGTH.MIN) return 'tooShort'
  if (ticketTrimmed.length > TICKET_LENGTH.MAX) return 'tooLong'
  if (!ALPHANUMERIC_REGEX.test(ticketTrimmed)) return 'invalidChars'
  if (ONLY_NUMBERS_REGEX.test(ticketTrimmed)) return 'onlyNumbers'
  return null
}

export const cleanTicket = (ticket: string): string => {
  if (!ticket) return ''
  return ticket
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, TICKET_LENGTH.MAX)
    .toUpperCase()
}
