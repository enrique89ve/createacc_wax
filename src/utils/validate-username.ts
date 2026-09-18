/**
 * Username format codes for the UI.
 * Returns null if the name is valid; otherwise a code mapped in i18n dictionaries.
 */

const MIN_SEGMENT_LENGTH = 3 as const
const MAX_ACCOUNT_LENGTH = 16 as const

export const USERNAME_FORMAT_CODES = [
  'empty',
  'tooShort',
  'tooLong',
  'startLowercase',
  'onlyAllowed',
  'endLowerOrDigit',
  'segmentStartLowercase',
  'segmentOnlyAllowed',
  'segmentEndLowerOrDigit',
  'segmentTooShort',
] as const

export type UsernameFormatCode = (typeof USERNAME_FORMAT_CODES)[number]

const DOT_REGEX = /\./
const STARTS_WITH_LOWERCASE_REGEX = /^[a-z]/
const ALLOWED_CHARS_REGEX = /^[a-z0-9-]*$/
const ENDS_WITH_LOWERCASE_OR_DIGIT_REGEX = /[a-z0-9]$/

export const validateAccountName = (
  value: string
): UsernameFormatCode | null => {
  if (!value) return 'empty'
  const totalLength = value.length
  if (totalLength < MIN_SEGMENT_LENGTH) return 'tooShort'
  if (totalLength > MAX_ACCOUNT_LENGTH) return 'tooLong'

  const isSegmented = DOT_REGEX.test(value)
  const segments = value.split('.')
  for (const segment of segments) {
    if (!STARTS_WITH_LOWERCASE_REGEX.test(segment)) {
      return isSegmented ? 'segmentStartLowercase' : 'startLowercase'
    }
    if (!ALLOWED_CHARS_REGEX.test(segment)) {
      return isSegmented ? 'segmentOnlyAllowed' : 'onlyAllowed'
    }
    if (!ENDS_WITH_LOWERCASE_OR_DIGIT_REGEX.test(segment)) {
      return isSegmented ? 'segmentEndLowerOrDigit' : 'endLowerOrDigit'
    }
    if (segment.length < MIN_SEGMENT_LENGTH) {
      return isSegmented ? 'segmentTooShort' : 'tooShort'
    }
  }
  return null
}

export const clearUsername = (username: string): string =>
  username.slice(0, MAX_ACCOUNT_LENGTH)
