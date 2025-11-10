/**
 * Utilidad para estandarizar respuestas de error en API routes
 * Basado en patrones de la-velada-web-oficial y mejores prácticas
 */

import { AppError, AppErrorCode } from '@/consts/errors'
import { getHttpStatus } from '@/consts/unified-errors'
import { processErrorSync, type ErrorContext } from '@/lib/error-chain'

export interface ApiErrorResponse {
  error: string
  code: string
  message: string
  timestamp: string
}

export interface ApiSuccessResponse<T = unknown> {
  success: true
  data: T
  timestamp: string
}

interface ResponseOptions {
  readonly noCache?: boolean
  readonly headers?: Record<string, string>
}

/**
 * Crea una respuesta compatible con el formato actual de la API
 * Para migración gradual desde createJsonResponse hacia el sistema unificado
 */
export function createCompatibleErrorResponse(
  error: unknown,
  status?: number,
  options?: ResponseOptions
): Response {
  // Usar la cadena de procesamiento completa
  const processed = processErrorSync(error, {
    metadata: { compatibilityMode: true },
  })

  const responseBody = {
    success: false,
    message: processed.userMessage,
    error: processed.userMessage,
    errorCode: processed.error.code,
    timestamp: processed.context.timestamp,
  }

  return createResponseWithOptions(
    responseBody,
    status || processed.httpStatus,
    options
  )
}

/**
 * Crea una respuesta de éxito compatible con createJsonResponse
 */
export function createCompatibleSuccessResponse<T>(
  data: T,
  status: number = 200,
  options?: ResponseOptions
): Response {
  return createResponseWithOptions(data, status, options)
}

/**
 * Helper interno para crear Response con opciones de headers
 */
function createResponseWithOptions(
  body: unknown,
  status: number,
  options?: ResponseOptions
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (options?.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      headers[k] = v
    }
  }

  if (options?.noCache) {
    headers['Cache-Control'] = 'no-store'
  }

  return new Response(JSON.stringify(body), {
    status,
    headers,
  })
}

/**
 * Reemplazo directo para createJsonResponse - mantiene exactamente la misma API
 * Para migración transparente sin cambiar contratos de API existentes
 */
export function createJsonResponse(
  body: unknown,
  status: number,
  options?: ResponseOptions
): Response {
  return createResponseWithOptions(body, status, options)
}
