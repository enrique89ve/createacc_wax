/**
 * Account name validation.
 * Returns null if the name is valid; otherwise a descriptive message.
 */

// Length constants
const MIN_SEGMENT_LENGTH = 3 as const
const MAX_ACCOUNT_LENGTH = 16 as const

// Base messages
const enum MessagePrefix {
  ACCOUNT = 'Account name should ',
  SEGMENT = 'Each account segment should ',
}

// Specific error messages (without prefix)
const enum MessageSuffix {
  NOT_EMPTY = 'not be empty.',
  BE_LONGER = 'be longer.',
  BE_SHORTER = 'be shorter.',
  START_LOWER = 'start with a lowercase letter.',
  ONLY_ALLOWED = 'have only lowercase letters, digits, or dashes.',
  END_LOWER_OR_DIGIT = 'end with a lowercase letter or digit.',
}

// Regular expressions (precompiled) with explicit names
const DOT_REGEX = /\./
const STARTS_WITH_LOWERCASE_REGEX = /^[a-z]/
const ALLOWED_CHARS_REGEX = /^[a-z0-9-]*$/
const ENDS_WITH_LOWERCASE_OR_DIGIT_REGEX = /[a-z0-9]$/

export const validateAccountName = (value: string): string | null => {
  let prefix: MessagePrefix = MessagePrefix.ACCOUNT
  if (!value) {
    return prefix + MessageSuffix.NOT_EMPTY
  }
  const totalLength = value.length
  if (totalLength < MIN_SEGMENT_LENGTH) {
    return prefix + MessageSuffix.BE_LONGER
  }
  if (totalLength > MAX_ACCOUNT_LENGTH) {
    return prefix + MessageSuffix.BE_SHORTER
  }
  if (DOT_REGEX.test(value)) {
    prefix = MessagePrefix.SEGMENT
  }
  const segments = value.split('.')
  for (const segment of segments) {
    if (!STARTS_WITH_LOWERCASE_REGEX.test(segment)) {
      return prefix + MessageSuffix.START_LOWER
    }
    if (!ALLOWED_CHARS_REGEX.test(segment)) {
      return prefix + MessageSuffix.ONLY_ALLOWED
    }
    if (!ENDS_WITH_LOWERCASE_OR_DIGIT_REGEX.test(segment)) {
      return prefix + MessageSuffix.END_LOWER_OR_DIGIT
    }
    if (segment.length < MIN_SEGMENT_LENGTH) {
      return prefix + MessageSuffix.BE_LONGER
    }
  }
  return null
}

/** Limits the username to the maximum allowed characters */
export const clearUsername = (username: string): string =>
  username.slice(0, MAX_ACCOUNT_LENGTH)
