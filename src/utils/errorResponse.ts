/**
 * Utilidad para estandarizar respuestas de error en API routes
 */

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

/**
 * Helper para respuestas de éxito simples
 * Uso: return apiSuccess({ data: result })
 */
export function apiSuccess<T>(
  data: T,
  status: number = 200,
  options?: ResponseOptions
): Response {
  const body = {
    success: true,
    ...data,
  }
  return createResponseWithOptions(body, status, options)
}

/**
 * Helper para respuestas de error simples
 * Uso: return apiError('Error message', 400)
 */
export function apiError(
  error: string,
  status: number,
  details?: unknown,
  options?: ResponseOptions
): Response {
  const body: Record<string, unknown> = {
    success: false,
    error,
  }

  if (details !== undefined) {
    body.details = details
  }

  return createResponseWithOptions(body, status, options)
}
