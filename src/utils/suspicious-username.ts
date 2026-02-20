import {
  SUSPICIOUS_ACCOUNTS,
  SUSPICIOUS_PATTERNS,
} from '@/data/suspicious-accounts'

/**
 * Optimized cache for ultra-fast lookups
 */
let suspiciousAccountsSet: Set<string> | null = null
let suspiciousSubstringsSet: Set<string> | null = null

/**
 * Initializes the suspicious accounts cache (only once)
 * Complexity: O(1) after the first call
 */
function initializeSuspiciousCache() {
  if (suspiciousAccountsSet === null) {
    // Set for exact lookup O(1)
    suspiciousAccountsSet = new Set(
      SUSPICIOUS_ACCOUNTS.map(account => account.toLowerCase())
    )
    // Set for common substrings O(1) - more selective
    suspiciousSubstringsSet = new Set([
      'admin',
      'root',
      'mod',
      'spam',
      'scam',
      'fake',
      'hack',
      'hive',
      'steem',
      'bitcoin',
      'nazi',
      'kill',
      'drug',
      'rape',
      'terrorist',
    ])
  }
}

/**
 * Ultra-fast validation of suspicious user
 * Optimized for maximum speed with multiple strategies
 *
 * @param username - Username to validate
 * @returns true if suspicious, false if safe
 */
export function isSuspiciousUsername(username: string): boolean {
  try {
    // Basic validation
    if (!username || typeof username !== 'string') {
      return true // Invalid input is suspicious
    }

    const cleanUsername = username.toLowerCase().trim()

    // Suspicious length
    if (cleanUsername.length < 3 || cleanUsername.length > 16) {
      return true
    }

    // Initialize cache once
    initializeSuspiciousCache()

    // 1. EXACT LOOKUP (fastest - O(1))
    if (suspiciousAccountsSet!.has(cleanUsername)) {
      return true
    }

    // 2. REGEX PATTERNS (very fast)
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(cleanUsername)) {
        return true
      }
    }

    // 3. COMMON SUBSTRINGS (fast - O(1) per substring)
    for (const suspicious of suspiciousSubstringsSet!) {
      if (cleanUsername.includes(suspicious)) {
        return true
      }
    }

    // 4. SPECIFIC VALIDATIONS (very fast)

    // Numbers only
    if (/^\d+$/.test(cleanUsername)) {
      return true
    }

    // Excessive repeated characters
    if (/(.)\1{4,}/.test(cleanUsername)) {
      return true
    }

    // Suspicious alternating patterns
    if (/^(.)(.)\1\2\1\2/.test(cleanUsername)) {
      return true
    }

    // Keyboard sequences (qwerty, asdf, etc.)
    const keyboardPatterns = ['qwerty', 'asdf', 'zxcv', '123456', 'abcdef']
    for (const pattern of keyboardPatterns) {
      if (cleanUsername.includes(pattern)) {
        return true
      }
    }

    // 5. ENTROPY DETECTION (Bot-generated names)
    
    // Streak of 4 or more consecutive consonants (ignores numbers in between to evaluate readability)
    const lettersOnly = cleanUsername.replace(/[^a-z]/g, '')
    if (/[bcdfghjklmnpqrstvwxyz]{4,}/.test(lettersOnly)) {
      return true
    }

    // Meaningless interspersed letters and numbers (e.g. x1y2z3 or a1b2c3d4)
    if (/([a-z]\d){3,}|(\d[a-z]){3,}/.test(cleanUsername)) {
      return true
    }

    return false
  } catch (error) {
    return true // In case of error, consider suspicious for security
  }
}

/**
 * More permissive validation with customizable threshold
 * Only use if additional flexibility is needed
 *
 * @param username - Username to validate
 * @param strictMode - Whether to use strict mode (default: true)
 * @returns true if suspicious
 */
export function isSuspiciousUsernameFlexible(
  username: string,
  strictMode: boolean = true
): boolean {
  if (!strictMode) {
    // Permissive mode: only block the most obvious
    const cleanUsername = username.toLowerCase().trim()

    initializeSuspiciousCache()

    // Only exact lookup and most obvious patterns
    if (suspiciousAccountsSet!.has(cleanUsername)) {
      return true
    }

    // Only the most restrictive patterns
    if (
      /^(admin|root|bot|spam|scam|fake|hack|nazi|kill)\d*$/i.test(cleanUsername)
    ) {
      return true
    }

    return false
  }

  return isSuspiciousUsername(username)
}

/**
 * Gets specific reason why a username is suspicious
 * Useful for logs and debugging
 *
 * @param username - Username to validate
 * @returns string with the reason or null if not suspicious
 */
export function getSuspiciousReason(username: string): string | null {
  try {
    if (!username || typeof username !== 'string') {
      return 'Invalid input'
    }

    const cleanUsername = username.toLowerCase().trim()

    if (cleanUsername.length < 3) {
      return 'Too short'
    }

    if (cleanUsername.length > 16) {
      return 'Too long'
    }

    initializeSuspiciousCache()

    if (suspiciousAccountsSet!.has(cleanUsername)) {
      return `Exact match: ${cleanUsername}`
    }

    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(cleanUsername)) {
        return `Pattern match: ${pattern.source}`
      }
    }

    for (const suspicious of suspiciousSubstringsSet!) {
      if (cleanUsername.includes(suspicious)) {
        return `Contains: ${suspicious}`
      }
    }

    if (/^\d+$/.test(cleanUsername)) {
      return 'Numbers only'
    }

    if (/(.)\1{4,}/.test(cleanUsername)) {
      return 'Repeated characters'
    }

    const lettersOnly = cleanUsername.replace(/[^a-z]/g, '')
    if (/[bcdfghjklmnpqrstvwxyz]{4,}/.test(lettersOnly)) {
      return 'High entropy: consecutive consonants'
    }

    if (/([a-z]\d){3,}|(\d[a-z]){3,}/.test(cleanUsername)) {
      return 'High entropy: alternating letters and numbers'
    }

    return null
  } catch (error) {
    return `Error: ${error}`
  }
}

/**
 * Detection system statistics
 */
export function getSuspiciousStats() {
  return {
    totalSuspiciousAccounts: SUSPICIOUS_ACCOUNTS.length,
    totalPatterns: SUSPICIOUS_PATTERNS.length,
    cacheInitialized: suspiciousAccountsSet !== null,
  }
}

/**
 * Clear cache (useful for testing)
 */
export function clearSuspiciousCache() {
  suspiciousAccountsSet = null
  suspiciousSubstringsSet = null
}

/**
 * Type guard that verifies if a username is valid (not suspicious)
 * Combines type and content validation in a single function
 * @param username - Username to validate
 * @returns true if valid string and not suspicious
 */
export function isValidUsername(username: unknown): username is string {
  return typeof username === 'string' && !isSuspiciousUsername(username)
}

/**
 * Type guard that verifies if an input is a valid string for username
 * Only validates type and basic format, not suspicious content
 * @param input - Input to validate
 * @returns true if string with valid username format
 */
export function isUsernameFormat(input: unknown): input is string {
  if (typeof input !== 'string') {
    return false
  }

  const cleaned = input.toLowerCase().trim()
  return (
    cleaned.length >= 3 && cleaned.length <= 16 && /^[a-z0-9.-]+$/.test(cleaned)
  )
}
