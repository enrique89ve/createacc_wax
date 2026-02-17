import type { APIRoute } from 'astro'
import { ensureCreation } from '@/lib/session-helpers'
import { CreationSessionManager } from '@/lib/session-manager'
import { HTTP_STATUS, API_MESSAGES } from '@/consts/constants'
import type { PublicKeysPayload } from '@/types/keys'
import {
  createCompatibleSuccessResponse,
  createCompatibleErrorResponse,
} from '@/utils/errorResponse'
import { validateHiveKeySet } from '@/utils/key-validation'
import { checkCreationRateLimit, createRateLimitResponse } from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'

export const POST: APIRoute = async context => {
  try {
    // F3 FIX: Rate-limit keys-hash endpoint
    const clientIp = resolveClientIp(context)
    const rateLimit = checkCreationRateLimit('keysHash', clientIp)
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit.retryAfterMs)
    }

    const existing = await ensureCreation(context)
    if (!existing) {
      return createCompatibleErrorResponse(
        new Error(API_MESSAGES.ERROR.NO_SESSION),
        HTTP_STATUS.UNAUTHORIZED,
        { noCache: true }
      )
    }

    const body: PublicKeysPayload = await context.request.json()
    const { ownerPublicKey, activePublicKey, postingPublicKey, memoPublicKey } =
      body

    // Validar que todas las claves públicas estén presentes
    if (
      !ownerPublicKey ||
      !activePublicKey ||
      !postingPublicKey ||
      !memoPublicKey
    ) {
      return createCompatibleErrorResponse(
        new Error(API_MESSAGES.ERROR.MISSING_KEYS),
        HTTP_STATUS.BAD_REQUEST,
        { noCache: true }
      )
    }

    // Validar formato de las claves públicas usando validación unificada wax
    try {
      validateHiveKeySet({
        ownerPublicKey,
        activePublicKey,
        postingPublicKey,
        memoPublicKey,
      })
    } catch (keyError) {
      return createCompatibleErrorResponse(keyError, HTTP_STATUS.BAD_REQUEST, {
        noCache: true,
      })
    }

    // Marcar como descargado en la sesión
    const sessionManager = new CreationSessionManager(
      context.cookies,
      context.request
    )
    sessionManager.set({
      ...existing,
      confirmedDownload: true,
    })

    return createCompatibleSuccessResponse({ success: true }, HTTP_STATUS.OK, {
      noCache: true,
    })
  } catch (error) {
    return createCompatibleErrorResponse(
      error,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      { noCache: true }
    )
  }
}
