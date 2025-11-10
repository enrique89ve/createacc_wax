/**
 * SIMPLIFIED ERROR PROCESSING CHAIN
 *
 * Versión simplificada del sistema de manejo de errores.
 * Mantiene funcionalidad esencial sin over-engineering.
 */

import {
  UnifiedError,
  type UnifiedErrorCode,
  getHttpStatus,
  getErrorMessage,
} from '@/consts/unified-errors'

import {
  analyzeWaxError,
  shouldRetryWaxError,
  formatWaxErrorForUser,
} from '@/lib/wax-error-utils'

// ===== SIMPLIFIED INTERFACES =====

export interface ErrorContext {
  readonly timestamp: string
  readonly correlationId?: string
  readonly userAgent?: string
  readonly path?: string
  readonly method?: string
  metadata?: Record<string, unknown>
}

export interface ProcessedError {
  readonly error: UnifiedError
  readonly context: ErrorContext
  readonly shouldRetry: boolean
  readonly httpStatus: number
  readonly userMessage: string
  readonly technicalDetails?: unknown
}

/**
 * Procesador simplificado de errores
 * Combina análisis y formateo en un solo paso
 */
export class SimplifiedErrorProcessor {
  /**
   * Procesa un error de manera simplificada
   */
  process(error: unknown, context?: Partial<ErrorContext>): ProcessedError {
    // Normalizar error
    const normalizedError = this.normalizeError(error)

    // Convertir a UnifiedError
    const unifiedError = this.unifyError(normalizedError)

    // Crear contexto completo
    const fullContext = this.createFullContext(context)

    // Determinar si es retryable
    const shouldRetry = this.determineRetryability(
      unifiedError,
      normalizedError
    // Generar mensaje de usuario
    const userMessage = this.generateUserMessage(unifiedError, normalizedError)

    // Obtener status HTTP
    const httpStatus = getHttpStatus(unifiedError.code)

    return {
      error: unifiedError,
      context: fullContext,
      shouldRetry,
      httpStatus,
      userMessage,
      technicalDetails: this.extractTechnicalDetails(normalizedError),
    }
  }

  private normalizeError(error: unknown): Error {
    if (error instanceof Error) return error
    if (error instanceof UnifiedError) return error

    const message =
      typeof error === 'string'
        ? error
        : error && typeof error === 'object'
          ? String((error as any).message || error)
          : 'Unknown error'

    return new Error(message)
  }

  private unifyError(error: Error): UnifiedError {
    // Usar análisis Wax si es aplicable
    const waxAnalysis = analyzeWaxError(error)
    if (waxAnalysis.code !== 'GENERIC_HIVE_ERROR') {
      return new UnifiedError(
        waxAnalysis.code as UnifiedErrorCode,
        error.message,
        error,
        'blockchain'
      )
    }

    // Mapeo simple por patrones
    const code = this.mapErrorToCode(error.message)
    return new UnifiedError(code, error.message, error, 'blockchain')
  }

  private mapErrorToCode(message: string): UnifiedErrorCode {
    const msg = message.toLowerCase()

    if (
      msg.includes('account') &&
      msg.includes('not') &&
      msg.includes('exist')
    ) {
      return 'ACCOUNT_NOT_EXISTS'
    }
    if (
      msg.includes('account') &&
      msg.includes('already') &&
      msg.includes('exist')
    ) {
      return 'ACCOUNT_ALREADY_EXISTS'
    }
    if (msg.includes('insufficient') && msg.includes('rc')) {
      return 'INSUFFICIENT_RC'
    }
    if (msg.includes('timeout')) {
      return 'CHAIN_VERIFICATION_TIMEOUT'
    }

    return 'INTERNAL_ERROR'
  }

  private createFullContext(partial?: Partial<ErrorContext>): ErrorContext {
    return {
      timestamp: new Date().toISOString(),
      correlationId: partial?.correlationId,
      userAgent: partial?.userAgent,
      path: partial?.path,
      method: partial?.method,
      metadata: partial?.metadata || {},
    }
  }

  private determineRetryability(
    unifiedError: UnifiedError,
    originalError: Error
  ): boolean {
    // Usar análisis Wax si está disponible
    if (shouldRetryWaxError(originalError)) {
      return true
    }

    // Lógica simple por código
    const retryableCodes: UnifiedErrorCode[] = [
      'INTERNAL_ERROR',
      'CHAIN_VERIFICATION_TIMEOUT',
    ]

    return retryableCodes.includes(unifiedError.code)
  }

  private generateUserMessage(
    unifiedError: UnifiedError,
    originalError: Error
  ): string {
    // Intentar mensaje específico de Wax
    const waxMessage = formatWaxErrorForUser(originalError)
    if (
      waxMessage !==
      'Ha ocurrido un error inesperado. Por favor, inténtalo de nuevo.'
    ) {
      return waxMessage
    }

    // Usar mensaje unificado
    try {
      return getErrorMessage(unifiedError.code)
    } catch {
      return unifiedError.message || 'Ha ocurrido un error inesperado'
    }
  }

  private extractTechnicalDetails(error: Error): unknown {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'),
    }
  }
}

// ===== SINGLETON INSTANCE =====

const processor = new SimplifiedErrorProcessor()

/**
 * Función principal para procesar errores (síncrona)
 */
export function processErrorSync(
  error: unknown,
  context?: Partial<ErrorContext>
): ProcessedError {
  return processor.process(error, context)
}

/**
 * Función principal para procesar errores (asíncrona - por compatibilidad)
 */
export async function processError(
  error: unknown,
  context?: Partial<ErrorContext>
): Promise<ProcessedError> {
  return processor.process(error, context)
}

/**
 * Wraps a handler so any thrown value goes through the simplified chain.
 */
export function withErrorChain<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult,
  contextExtractor?: (...args: TArgs) => Partial<ErrorContext>
) {
  return async (...args: TArgs): Promise<TResult> => {
    try {
      return await fn(...args)
    } catch (error) {
      const context = contextExtractor ? contextExtractor(...args) : undefined
      const processed = processErrorSync(error, context)
      throw processed.error
    }
  }
}
