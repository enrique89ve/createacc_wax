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
 * Mapeo de nombres de error de Wax a categorías
 * Actualizado con todos los tipos de error oficiales de @hiveio/wax
 */
const ERROR_TYPE_MAPPING: Record<string, WaxErrorInfo['category']> = {
  // Request errors (network-related)
  WaxRequestError: 'network',
  WaxRequestTimeoutError: 'network',
  WaxRequestAbortedByUser: 'network',
  WaxNon_2XX_3XX_ResponseCodeError: 'network',
  WaxUnknownRequestError: 'network',

  // HealthChecker errors (network-related)
  WaxHealthCheckerEndpointUrlError: 'network',
  WaxHealthCheckerError: 'network',

  // API errors
  WaxChainApiError: 'api',
  WaxHealthCheckerValidatorFailedError: 'api',

  // Business/Security errors
  WaxPrivateKeyLeakDetectedException: 'business',

  // Generic fallback
  WaxError: 'unknown',
}

/**
 * Type guards para detectar tipos específicos de errores WAX
 */
function isWaxChainApiError(
	error: unknown,
): error is WaxChainApiError & { apiError: unknown } {
	return (
		error instanceof WaxChainApiError ||
		(typeof error === 'object' &&
			error !== null &&
			'apiError' in error &&
			'name' in error &&
			(error as Record<string, unknown>).name === 'WaxChainApiError')
	)
}

function isWaxRequestError(error: unknown): error is WaxRequestError {
	return (
		error instanceof WaxRequestError ||
		(typeof error === 'object' &&
			error !== null &&
			'name' in error &&
			typeof (error as Record<string, unknown>).name === 'string' &&
			((error as Record<string, unknown>).name as string).includes(
				'WaxRequest',
			))
	)
}

function isWaxError(error: unknown): error is WaxError {
	return (
		error instanceof WaxError ||
		(typeof error === 'object' &&
			error !== null &&
			'name' in error &&
			typeof (error as Record<string, unknown>).name === 'string' &&
			((error as Record<string, unknown>).name as string).startsWith('Wax'))
	)
}

/**
 * Analiza un error de @hiveio/wax y lo clasifica
 * Ahora usa type guards y datos estructurados de errores WAX
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

  const err = error as Record<string, unknown>
  const errorName = String(err.name || 'UnknownError')
  let errorMessage = String(err.message || 'No message')

  // Si es WaxChainApiError, intentar extraer mensaje del apiError
  if (isWaxChainApiError(error) && error.apiError) {
    const apiError = error.apiError as Record<string, unknown>
    if (apiError.message && typeof apiError.message === 'string') {
      errorMessage = apiError.message
    } else if (typeof error.apiError === 'string') {
      errorMessage = error.apiError
    }
  }

  // Determinar categoría por nombre de error usando type guards primero
  let category: WaxErrorInfo['category'] = 'unknown'
  if (isWaxRequestError(error)) {
    category = 'network'
  } else if (isWaxChainApiError(error)) {
    category = 'api'
  } else if (isWaxError(error)) {
    // Usar mapping para otros tipos de WaxError
    category = ERROR_TYPE_MAPPING[errorName] || 'unknown'
  } else {
    category = ERROR_TYPE_MAPPING[errorName] || 'unknown'
  }

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
