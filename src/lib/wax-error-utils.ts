/**
 * Robust utility for handling @hiveio/wax errors
 * Provides intelligent error classification and structured logging
 */

import { AppErrorCode } from '@/consts/errors'
import {
	WaxError,
	WaxChainApiError,
	WaxRequestError,
	WaxRequestTimeoutError,
	WaxRequestAbortedByUser,
	WaxAssertionError,
	WaxNon_2XX_3XX_ResponseCodeError,
	WaxUnknownRequestError,
	WaxMalformedJsonError,
	WaxHealthCheckerError,
	WaxHealthCheckerValidatorFailedError,
	WaxPrivateKeyLeakDetectedException,
} from '@hiveio/wax'

/**
 * Specific error types from @hiveio/wax
 */
export interface WaxErrorInfo {
  readonly name: string
  readonly message: string
  readonly code: AppErrorCode
  readonly isRetryable: boolean
  readonly category: 'network' | 'api' | 'business' | 'unknown'
}

/**
 * Known Hive error patterns with regular expressions
 * Simplified patterns to match real Hive API messages
 */
const KNOWN_ERROR_PATTERNS: Array<{
  readonly pattern: RegExp
  readonly code: AppErrorCode
  readonly category: WaxErrorInfo['category']
  readonly isRetryable: boolean
}> = [
  {
    pattern: /account.*doesn't exist/i,
    code: AppErrorCode.ACCOUNT_NOT_EXISTS,
    category: 'business',
    isRetryable: false,
  },
  {
    pattern: /account.*already exists/i,
    code: AppErrorCode.ACCOUNT_ALREADY_EXISTS,
    category: 'business',
    isRetryable: false,
  },
  {
    pattern: /insufficient resource credits/i,
    code: AppErrorCode.INSUFFICIENT_RC,
    category: 'business',
    isRetryable: false,
  },
  {
    pattern: /delegation.*same amount/i,
    code: AppErrorCode.RC_DELEGATION_EXISTS,
    category: 'business',
    isRetryable: false,
  },
  {
    pattern: /network|timeout|connection|fetch/i,
    code: AppErrorCode.GENERIC_HIVE_ERROR,
    category: 'network',
    isRetryable: true,
  },
  {
    pattern: /invalid.*response|api.*error/i,
    code: AppErrorCode.GENERIC_HIVE_ERROR,
    category: 'api',
    isRetryable: true,
  },
]

/**
 * Classifies a Wax error by instanceof and returns its category
 * Order: more specific subclasses first, then base classes
 */
function classifyByInstance(error: unknown): WaxErrorInfo['category'] | null {
	// Request subclasses → network
	if (error instanceof WaxRequestTimeoutError) return 'network'
	if (error instanceof WaxRequestAbortedByUser) return 'network'
	if (error instanceof WaxNon_2XX_3XX_ResponseCodeError) return 'network'
	if (error instanceof WaxMalformedJsonError) return 'network'
	if (error instanceof WaxUnknownRequestError) return 'network'
	// Request base → network
	if (error instanceof WaxRequestError) return 'network'

	// HealthChecker → network/api
	if (error instanceof WaxHealthCheckerValidatorFailedError) return 'api'
	if (error instanceof WaxHealthCheckerError) return 'network'

	// Chain API → api
	if (error instanceof WaxChainApiError) return 'api'

	// Assertion errors (tx.validate()) → business
	if (error instanceof WaxAssertionError) return 'business'

	// Security → business
	if (error instanceof WaxPrivateKeyLeakDetectedException) return 'business'

	// Generic WaxError base → unknown
	if (error instanceof WaxError) return 'unknown'

	return null
}

/**
 * Extracts the most informative message from a WaxChainApiError
 */
function extractApiErrorMessage(error: WaxChainApiError): string | null {
	const apiError: unknown = error.apiError
	if (!apiError) return null

	if (typeof apiError === 'string') return apiError
	if (typeof apiError === 'object' && apiError !== null && 'message' in apiError) {
		const msg = (apiError as Record<string, unknown>).message
		if (typeof msg === 'string') return msg
	}

	return null
}

/**
 * Type guard to check if an error is an instance of WaxError
 */
export function isWaxError(error: unknown): error is WaxError {
	return error instanceof WaxError
}

/**
 * Analyzes a @hiveio/wax error and classifies it
 * Uses instanceof for real type safety against all exported classes
 */
export function analyzeWaxError(error: unknown): WaxErrorInfo {
	if (!error || typeof error !== 'object') {
		return {
			name: 'UnknownError',
			message: 'Unknown error occurred',
			code: AppErrorCode.GENERIC_HIVE_ERROR,
			isRetryable: false,
			category: 'unknown',
		}
	}

	const errorName = error instanceof Error ? error.name : 'UnknownError'
	let errorMessage = error instanceof Error ? error.message : 'No message'

	// Extract detailed message from WaxChainApiError
	if (error instanceof WaxChainApiError) {
		const apiMessage = extractApiErrorMessage(error)
		if (apiMessage) errorMessage = apiMessage
	}

	// Classify by instanceof
	const category = classifyByInstance(error) ?? 'unknown'

	// Find known pattern in the message (for Hive business errors)
	for (const {
		pattern,
		code,
		category: patternCategory,
		isRetryable,
	} of KNOWN_ERROR_PATTERNS) {
		if (pattern.test(errorMessage)) {
			return {
				name: errorName,
				message: errorMessage,
				code,
				isRetryable,
				category: patternCategory,
			}
		}
	}

	// Unrecognized error but classifiable by type
	const isRetryable = category === 'network' || category === 'api'

	return {
		name: errorName,
		message: errorMessage,
		code: AppErrorCode.GENERIC_HIVE_ERROR,
		isRetryable,
		category,
	}
}

/**
 * Determines if an error should trigger a retry mechanism
 */
export function shouldRetryWaxError(error: unknown): boolean {
  const errorInfo = analyzeWaxError(error)
  return errorInfo.isRetryable
}

/**
 * User-friendly error messages
 */
const USER_ERROR_MESSAGES: Record<AppErrorCode, string> = {
  [AppErrorCode.ACCOUNT_NOT_EXISTS]: 'The specified account does not exist on Hive',
  [AppErrorCode.ACCOUNT_ALREADY_EXISTS]:
    'The username is already registered on Hive',
  [AppErrorCode.INSUFFICIENT_RC]:
    'Not enough Resource Credits to complete the operation',
  [AppErrorCode.RC_DELEGATION_EXISTS]:
    'An RC delegation with the same amount already exists for this user',
  [AppErrorCode.MISSING_WALLET_CONFIG]:
    'Wallet configuration is required',
  [AppErrorCode.SELF_DELEGATION]:
    'You cannot delegate Resource Credits to yourself',
  [AppErrorCode.SELF_REMOVAL]:
    'You cannot remove your own Resource Credits delegation',
  [AppErrorCode.GENERIC_HIVE_ERROR]:
    'An unexpected error has occurred. Please try again.',
  [AppErrorCode.CHAIN_VERIFICATION_FAILED]:
    'Blockchain verification failed. Please try again.',
  [AppErrorCode.CHAIN_VERIFICATION_TIMEOUT]:
    'Blockchain verification timed out. Please try again.',
}

/**
 * Creates a formatted error message for user
 */
export function formatWaxErrorForUser(error: unknown): string {
  const errorInfo = analyzeWaxError(error)

  // Use specific message for the code if it exists
  if (USER_ERROR_MESSAGES[errorInfo.code]) {
    return USER_ERROR_MESSAGES[errorInfo.code]
  }

  // Fallback based on category
  switch (errorInfo.category) {
    case 'network':
      return 'Connection error with the Hive network. Try again.'
    case 'api':
      return 'Hive API error. Please try again.'
    case 'business':
      return 'Validation error in the operation.'
    default:
      return 'An unexpected error has occurred. Please try again.'
  }
}

/**
 * Gets error message for specific code
 */
export function getUserMessageForCode(code: AppErrorCode): string {
  return USER_ERROR_MESSAGES[code] || 'An unexpected error has occurred'
}

/**
 * Unified error handling system that combines analysis and formatting
 */
export function handleWaxError(error: unknown): {
  info: WaxErrorInfo
  userMessage: string
  shouldRetry: boolean
} {
  const info = analyzeWaxError(error)
  const userMessage = formatWaxErrorForUser(error)
  const shouldRetry = shouldRetryWaxError(error)

  return {
    info,
    userMessage,
    shouldRetry,
  }
}
