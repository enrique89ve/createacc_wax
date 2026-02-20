/**
 * ERROR NORMALIZER - Integrado con Error Processing Chain
 * 
 * Legacy utilities refactorizadas para usar el sistema unificado.
 * Mantiene compatibilidad hacia atrás mientras usa la nueva arquitectura.
 */

import { processErrorSync, type ErrorContext } from './error-chain'
import type { APIContext } from 'astro'

/**
 * Wrapper moderno que retorna ProcessedError directamente
 * Para código nuevo que quiera usar toda la información de la cadena
 */
export function wrapHandlerWithFullProcessing<TArgs extends unknown[], TResult>(
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
  handler: (context: APIContext) => Promise<TResult> | TResult
) {
  return wrapHandlerWithFullProcessing(
    handler,
    // Context extractor específico para API routes
    (context: APIContext): Partial<ErrorContext> => ({
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

  const log = (_tag: string, value: unknown) => {
    if (value instanceof Error) return
    // Se registra el valor bruto para investigación
  }

  process.on('uncaughtException', value => log('uncaught', value))
  process.on('unhandledRejection', value => log('rejection', value))
}
