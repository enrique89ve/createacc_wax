/**
 * ERROR NORMALIZER - Integrado con Error Processing Chain
 * 
 * Legacy utilities refactorizadas para usar el sistema unificado.
 * Mantiene compatibilidad hacia atrás mientras usa la nueva arquitectura.
 */

import { processErrorSync, withErrorChain, type ErrorContext } from './error-chain'
import { UnifiedError } from '@/consts/unified-errors'

// ===== LEGACY COMPATIBILITY =====

/**
 * @deprecated Usar UnifiedError del sistema unificado
 * Mantenido por compatibilidad hacia atrás
 */
export interface NormalizedError extends Error {
  readonly original?: unknown
  readonly code?: string
}

/**
 * Convierte cualquier valor en Error usando la cadena de procesamiento
 * @deprecated Usar processErrorSync() directamente para casos nuevos
 */
export function ensureError(
  value: unknown,
  defaultMessage = 'Unknown error'
): NormalizedError {
  // Usar la cadena de procesamiento para normalización completa
  const processed = processErrorSync(value, { 
    metadata: { defaultMessage } 
  })
  
  // Convertir ProcessedError de vuelta a NormalizedError para compatibilidad
  const normalizedError = processed.error as NormalizedError
  
  // Asegurar que tiene las propiedades que esperan los consumers legacy
  if (!normalizedError.original && value !== normalizedError) {
    ;(normalizedError as any).original = value
  }
  
  return normalizedError
}

/**
 * Wrapper mejorado que usa la cadena de procesamiento completa
 * Mantiene compatibilidad pero usa la nueva arquitectura internamente
 */
export function wrapHandler<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult,
  onError?: (err: NormalizedError) => void
) {
  return async (...args: TArgs): Promise<TResult> => {
    try {
      // Crear context extractor inline
      const context: Partial<ErrorContext> = {}
      const firstArg = args[0] as any
      if (firstArg && typeof firstArg === 'object') {
        if (firstArg.request) {
          Object.assign(context, {
            method: firstArg.request.method,
            userAgent: firstArg.request.headers?.get('user-agent') || undefined
          })
        }
        if (firstArg.url) {
          Object.assign(context, {
            path: firstArg.url.pathname
          })
        }
      }

      // Usar withErrorChain directamente
      const wrappedFn = withErrorChain(fn, () => context)
      return await wrappedFn(...args)
      
    } catch (unifiedError) {
      // Convertir a NormalizedError para callback legacy
      if (onError && unifiedError instanceof UnifiedError) {
        const legacyError = unifiedError as NormalizedError
        onError(legacyError)
      }
      
      // Re-throw para mantener el flujo
      throw unifiedError
    }
  }
}

// ===== ENHANCED UTILITIES =====

/**
 * Wrapper moderno que retorna ProcessedError directamente
 * Para código nuevo que quiera usar toda la información de la cadena
 */
export function wrapHandlerWithFullProcessing<TArgs extends any[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult,
  contextExtractor?: (...args: TArgs) => Partial<ErrorContext>
) {
  return async (...args: TArgs): Promise<TResult> => {
    try {
      return await fn(...args)
    } catch (error) {
      const context = contextExtractor ? contextExtractor(...args) : {}
      const processed = processErrorSync(error, context)
      
      // Log técnico del error procesado

      
      // Re-throw el error unificado
      throw processed.error
    }
  }
}

/**
 * Utility para API routes que automáticamente extrae contexto HTTP
 */
export function wrapApiHandler<TResult>(
  handler: (context: any) => Promise<TResult> | TResult
) {
  return wrapHandlerWithFullProcessing(
    handler,
    // Context extractor específico para API routes
    (context: any): Partial<ErrorContext> => ({
      method: context.request?.method,
      path: context.url?.pathname,
      userAgent: context.request?.headers?.get('user-agent') || undefined,
      correlationId: context.request?.headers?.get('x-correlation-id') || undefined,
    })
  )
}

// Instalación de ganchos globales una sola vez
declare const global: typeof globalThis & {
  __ERROR_HOOKS_INSTALLED__?: boolean
}

if (!global.__ERROR_HOOKS_INSTALLED__) {
  global.__ERROR_HOOKS_INSTALLED__ = true

  const log = (tag: string, value: unknown) => {
    if (value instanceof Error) return
    // Se registra el valor bruto para investigación

  }

  process.on('uncaughtException', value => log('uncaught', value))
  process.on('unhandledRejection', value => log('rejection', value))
}
