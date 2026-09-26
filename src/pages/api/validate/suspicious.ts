import type { APIRoute } from 'astro'
import { isSuspiciousUsername } from '@/utils/suspicious-username'
import {
  checkCreationRateLimit,
  createRateLimitResponse,
} from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'
import { z } from 'astro/zod'
import { apiError, apiSuccess, createJsonResponse } from '@/utils/errorResponse'
import { HTTP_STATUS } from '@/consts/constants'

const SuspiciousValidationRequestSchema = z.looseObject({
  username: z.string().min(1),
})

/**
 * F5b FIX: Reduced response - only returns isSuspicious boolean.
 * Removed: reason, stats, includeReason param, strictMode param, GET endpoint.
 */

export const POST: APIRoute = async context => {
  try {
    const { request } = context
    const clientIp = resolveClientIp(context)
    const rateLimit = checkCreationRateLimit('suspicious', clientIp)
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit.retryAfterMs)
    }

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      return apiError(
        'El cuerpo debe contener JSON válido',
        HTTP_STATUS.BAD_REQUEST
      )
    }
    const parsedBody = SuspiciousValidationRequestSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return apiError('Username es requerido', HTTP_STATUS.BAD_REQUEST)
    }

    const suspicious = isSuspiciousUsername(parsedBody.data.username)

    return apiSuccess({ isSuspicious: suspicious })
  } catch {
    return createJsonResponse(
      {
        success: false,
        error: 'Error interno del servidor',
        isSuspicious: true,
      },
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
