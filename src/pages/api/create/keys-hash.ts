import type { APIRoute } from 'astro'
import { ensureCreation } from '@/lib/session-helpers'
import { CreationSessionManager } from '@/lib/session-cookies'
import { HTTP_STATUS, API_MESSAGES } from '@/consts/constants'
import { hasForbiddenPrivateKeyFields } from '@/types/keys'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { validateHiveKeySet } from '@/utils/key-validation'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { checkCreationRateLimit, createRateLimitResponse } from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

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
      return apiError(
        API_MESSAGES.ERROR.NO_SESSION,
        HTTP_STATUS.UNAUTHORIZED,
        undefined,
        { noCache: true }
      )
    }

    const rawBody: unknown = await context.request.json()
    if (!isJsonObject(rawBody)) {
      return apiError(
        API_MESSAGES.ERROR.MISSING_KEYS,
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        { noCache: true }
      )
    }

    if (hasForbiddenPrivateKeyFields(rawBody)) {
      return apiError(
        VALIDATION_ERROR_MESSAGES.PRIVATE_KEYS_NOT_ALLOWED,
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        { noCache: true }
      )
    }

    const { ownerPublicKey, activePublicKey, postingPublicKey, memoPublicKey } =
      rawBody

    // Validate that all public keys are present
    if (
      !ownerPublicKey ||
      !activePublicKey ||
      !postingPublicKey ||
      !memoPublicKey
    ) {
      return apiError(
        API_MESSAGES.ERROR.MISSING_KEYS,
        HTTP_STATUS.BAD_REQUEST,
        undefined,
        { noCache: true }
      )
    }

    // Validate public keys format using unified wax validation
    try {
      validateHiveKeySet({
        ownerPublicKey,
        activePublicKey,
        postingPublicKey,
        memoPublicKey,
      })
    } catch (keyError) {
      const keyErrorMessage = keyError instanceof Error ? keyError.message : 'Key validation error'
      return apiError(keyErrorMessage, HTTP_STATUS.BAD_REQUEST, undefined, {
        noCache: true,
      })
    }

    // Mark as downloaded in the session
    const sessionManager = new CreationSessionManager(
      context.cookies,
      context.request
    )
    sessionManager.set({
      ...existing,
      confirmedDownload: true,
    })

    return apiSuccess({}, HTTP_STATUS.OK, {
      noCache: true,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error'
    return apiError(
      errorMessage,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      undefined,
      { noCache: true }
    )
  }
}
