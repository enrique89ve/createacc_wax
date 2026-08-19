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
	WaxProtocolAssertionError,
	WaxChainAssertionError,
	WaxNon_2XX_3XX_ResponseCodeError,
	WaxUnknownRequestError,
	WaxMalformedJsonError,
	WaxHealthCheckerError,
	WaxHealthCheckerValidatorFailedError,
	WaxPrivateKeyLeakDetectedException,
} from '@hiveio/wax'

const HTTP_SERVER_ERROR_MIN = 500
const PAYLOAD_WALK_MAX_DEPTH = 5
const INTERNAL_ERROR_EXCEPTION = 'internal_error_exception'

export interface WaxErrorInfo {
	readonly name: string
	readonly message: string
	readonly code: AppErrorCode
	readonly isRetryable: boolean
	readonly category: 'network' | 'api' | 'business' | 'unknown'
}

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
		pattern: /duplicate transaction/i,
		code: AppErrorCode.GENERIC_HIVE_ERROR,
		category: 'business',
		isRetryable: false,
	},
	{
		pattern: /transaction.*(expired|expire)|expired transaction/i,
		code: AppErrorCode.GENERIC_HIVE_ERROR,
		category: 'business',
		isRetryable: false,
	},
	{
		pattern: /invalid signature/i,
		code: AppErrorCode.GENERIC_HIVE_ERROR,
		category: 'business',
		isRetryable: false,
	},
	{
		pattern: /missing required (active|owner|posting)?\s*authority/i,
		code: AppErrorCode.GENERIC_HIVE_ERROR,
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function classifyByInstance(error: unknown): WaxErrorInfo['category'] | null {
	if (error instanceof WaxRequestTimeoutError) return 'network'
	if (error instanceof WaxRequestAbortedByUser) return 'network'
	if (error instanceof WaxNon_2XX_3XX_ResponseCodeError) return 'network'
	if (error instanceof WaxMalformedJsonError) return 'network'
	if (error instanceof WaxUnknownRequestError) return 'network'
	if (error instanceof WaxRequestError) return 'network'

	if (error instanceof WaxHealthCheckerValidatorFailedError) return 'api'
	if (error instanceof WaxHealthCheckerError) return 'network'

	if (error instanceof WaxChainApiError) return 'api'

	if (error instanceof WaxProtocolAssertionError) return 'business'
	if (error instanceof WaxChainAssertionError) return 'business'
	if (error instanceof WaxAssertionError) return 'business'

	if (error instanceof WaxPrivateKeyLeakDetectedException) return 'business'

	if (error instanceof WaxError) return 'unknown'

	return null
}

function extractMessageFromPayload(value: unknown, depth = 0): string | null {
	if (depth > PAYLOAD_WALK_MAX_DEPTH) return null
	if (typeof value === 'string' && value.trim().length > 0) return value
	if (!isRecord(value)) return null

	const message = value.message
	if (typeof message === 'string' && message.trim().length > 0) {
		return message
	}

	if ('error' in value) {
		const nested = extractMessageFromPayload(value.error, depth + 1)
		if (nested) return nested
	}

	if ('data' in value) {
		const nested = extractMessageFromPayload(value.data, depth + 1)
		if (nested) return nested
	}

	return null
}

function getWaxChainApiBody(error: WaxChainApiError): unknown {
	return error.response.response
}

function extractApiErrorMessage(error: WaxChainApiError): string | null {
	const fromBody = extractMessageFromPayload(getWaxChainApiBody(error))
	if (fromBody) return fromBody
	return error.message.length > 0 ? error.message : null
}

function hasInternalErrorName(value: unknown, depth = 0): boolean {
	if (depth > PAYLOAD_WALK_MAX_DEPTH || !isRecord(value)) return false
	if (value.name === INTERNAL_ERROR_EXCEPTION) return true
	if ('error' in value && hasInternalErrorName(value.error, depth + 1)) {
		return true
	}
	if ('data' in value && hasInternalErrorName(value.data, depth + 1)) {
		return true
	}
	return false
}

export function isInternalHiveServerError(error: unknown): boolean {
	if (!(error instanceof WaxChainApiError)) return false

	const status = error.response.status
	if (typeof status === 'number' && status >= HTTP_SERVER_ERROR_MIN) {
		return true
	}

	return hasInternalErrorName(getWaxChainApiBody(error))
}

export function isWaxError(error: unknown): error is WaxError {
	return error instanceof WaxError
}

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

	if (error instanceof WaxChainApiError) {
		const apiMessage = extractApiErrorMessage(error)
		if (apiMessage) errorMessage = apiMessage
	}

	const category = classifyByInstance(error) ?? 'unknown'

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

	const isRetryable = category === 'network' || category === 'api'

	return {
		name: errorName,
		message: errorMessage,
		code: AppErrorCode.GENERIC_HIVE_ERROR,
		isRetryable,
		category,
	}
}

export function shouldRetryWaxError(error: unknown): boolean {
	const errorInfo = analyzeWaxError(error)
	return errorInfo.isRetryable
}

export function shouldTriggerWaxFailover(error: unknown): boolean {
	if (isInternalHiveServerError(error)) return true
	return analyzeWaxError(error).category === 'network'
}

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

export function formatWaxErrorForUser(error: unknown): string {
	const errorInfo = analyzeWaxError(error)

	if (USER_ERROR_MESSAGES[errorInfo.code]) {
		return USER_ERROR_MESSAGES[errorInfo.code]
	}

	return deriveUserMessage(errorInfo)
}

export function getUserMessageForCode(code: AppErrorCode): string {
	return USER_ERROR_MESSAGES[code] || 'An unexpected error has occurred'
}

function deriveUserMessage(info: WaxErrorInfo): string {
	if (USER_ERROR_MESSAGES[info.code]) {
		return USER_ERROR_MESSAGES[info.code]
	}

	switch (info.category) {
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

export function handleWaxError(error: unknown): {
	info: WaxErrorInfo
	userMessage: string
	shouldRetry: boolean
} {
	const info = analyzeWaxError(error)

	return {
		info,
		userMessage: deriveUserMessage(info),
		shouldRetry: info.isRetryable,
	}
}
