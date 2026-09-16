/**
 * ERROR NORMALIZER - Integrated with Error Processing Chain
 *
 * Legacy utilities refactored to use the unified system.
 * Maintains backwards compatibility while using the new architecture.
 */

import { processErrorSync, type ErrorContext } from './error-chain'
import type { APIContext } from 'astro'
import { logger } from './logger'

/**
 * Modern wrapper that returns ProcessedError directly
 * For new code that wants to use all the information from the chain
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

      // Technical log of the processed error

      // Re-throw the unified error
      throw processed.error
    }
  }
}

/**
 * Utility for API routes that automatically extracts HTTP context
 */
export function wrapApiHandler<TResult>(
  handler: (context: APIContext) => Promise<TResult> | TResult
) {
  return wrapHandlerWithFullProcessing(
    handler,
    // Specific context extractor for API routes
    (context: APIContext): Partial<ErrorContext> => ({
      method: context.request?.method,
      path: context.url?.pathname,
      userAgent: context.request?.headers?.get('user-agent') || undefined,
      correlationId:
        context.request?.headers?.get('x-correlation-id') || undefined,
    })
  )
}

// Single-time installation of global hooks
declare const global: typeof globalThis & {
  __ERROR_HOOKS_INSTALLED__?: boolean
}

if (!global.__ERROR_HOOKS_INSTALLED__) {
  global.__ERROR_HOOKS_INSTALLED__ = true

  process.on('uncaughtException', value => {
    logger.error('[uncaughtException]', value)
  })

  process.on('unhandledRejection', value => {
    logger.error('[unhandledRejection]', value)
  })
}
