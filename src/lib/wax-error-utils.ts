/**
 * Utilidad robusta para manejo de errores de @hiveio/wax
 * Proporciona clasificación inteligente de errores y logging estructurado
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
 * Tipos de error específicos de @hiveio/wax
 */
export interface WaxErrorInfo {
  readonly name: string
  readonly message: string
  readonly code: AppErrorCode
  readonly isRetryable: boolean
  readonly category: 'network' | 'api' | 'business' | 'unknown'
}

/**
 * Patrón de errores conocidos de Hive con expresiones regulares
 * Patrones simplificados para coincidir con mensajes reales de Hive API
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
 * Clasifica un error Wax por instanceof y retorna su categoría
 * Orden: subclases más específicas primero, luego clases base
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
 * Extrae el mensaje más informativo de un WaxChainApiError
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
 * Type guard para verificar si un error es una instancia de WaxError
 */
export function isWaxError(error: unknown): error is WaxError {
	return error instanceof WaxError
}

/**
 * Analiza un error de @hiveio/wax y lo clasifica
 * Usa instanceof para type safety real contra todas las clases exportadas
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

	// Extraer mensaje detallado de WaxChainApiError
	if (error instanceof WaxChainApiError) {
		const apiMessage = extractApiErrorMessage(error)
		if (apiMessage) errorMessage = apiMessage
	}

	// Clasificar por instanceof
	const category = classifyByInstance(error) ?? 'unknown'

	// Buscar patrón conocido en el mensaje (para errores de negocio de Hive)
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

	// Error no reconocido pero clasificable por tipo
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
 * Determina si un error debe activar un mecanismo de reintento
 */
export function shouldRetryWaxError(error: unknown): boolean {
  const errorInfo = analyzeWaxError(error)
  return errorInfo.isRetryable
}

/**
 * Mensajes de error amigables para el usuario
 */
const USER_ERROR_MESSAGES: Record<AppErrorCode, string> = {
  [AppErrorCode.ACCOUNT_NOT_EXISTS]: 'La cuenta especificada no existe en Hive',
  [AppErrorCode.ACCOUNT_ALREADY_EXISTS]:
    'El nombre de usuario ya está registrado en Hive',
  [AppErrorCode.INSUFFICIENT_RC]:
    'No hay suficientes Resource Credits para completar la operación',
  [AppErrorCode.RC_DELEGATION_EXISTS]:
    'Ya existe una delegación de RC con la misma cantidad para este usuario',
  [AppErrorCode.MISSING_WALLET_CONFIG]:
    'La configuración de la billetera es requerida',
  [AppErrorCode.SELF_DELEGATION]:
    'No puedes delegar Resource Credits a ti mismo',
  [AppErrorCode.SELF_REMOVAL]:
    'No puedes remover tu propia delegación de Resource Credits',
  [AppErrorCode.GENERIC_HIVE_ERROR]:
    'Ha ocurrido un error inesperado. Por favor, inténtalo de nuevo.',
  [AppErrorCode.CHAIN_VERIFICATION_FAILED]:
    'La verificación en la blockchain ha fallado. Por favor, inténtalo de nuevo.',
  [AppErrorCode.CHAIN_VERIFICATION_TIMEOUT]:
    'La verificación en la blockchain ha excedido el tiempo de espera. Por favor, inténtalo de nuevo.',
}

/**
 * Crea un mensaje de error formateado para usuario
 */
export function formatWaxErrorForUser(error: unknown): string {
  const errorInfo = analyzeWaxError(error)

  // Usar mensaje específico del código si existe
  if (USER_ERROR_MESSAGES[errorInfo.code]) {
    return USER_ERROR_MESSAGES[errorInfo.code]
  }

  // Fallback basado en categoría
  switch (errorInfo.category) {
    case 'network':
      return 'Error de conexión con la red de Hive. Inténtalo de nuevo.'
    case 'api':
      return 'Error en la API de Hive. Por favor, inténtalo de nuevo.'
    case 'business':
      return 'Error de validación en la operación.'
    default:
      return 'Ha ocurrido un error inesperado. Por favor, inténtalo de nuevo.'
  }
}

/**
 * Obtiene mensaje de error para código específico
 */
export function getUserMessageForCode(code: AppErrorCode): string {
  return USER_ERROR_MESSAGES[code] || 'Ha ocurrido un error inesperado'
}

/**
 * Sistema unificado de manejo de errores que combina análisis y formateo
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
