import {
  checkCreationRateLimit,
  createRateLimitResponse,
} from '@/lib/creation-rate-limiter'
import { checkUsernamePolicy } from '@/lib/username-policy'
import { apiError, apiSuccess, createJsonResponse } from '@/utils/errorResponse'
import { HTTP_STATUS } from '@/consts/constants'

type UsernameRateLimitScope = 'username' | 'inviteUsername'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function handleUsernameValidation(
  request: Request,
  clientIp: string,
  rateLimitScope: UsernameRateLimitScope
): Promise<Response> {
  const rateLimit = checkCreationRateLimit(rateLimitScope, clientIp)
  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit.retryAfterMs)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return apiError(
      'The request body must contain valid JSON.',
      HTTP_STATUS.BAD_REQUEST
    )
  }
  if (
    !isRecord(payload) ||
    typeof payload.username !== 'string' ||
    !payload.username.trim()
  ) {
    return createJsonResponse(
      {
        success: false,
        error: 'Invalid username',
        status: 'invalid_request',
      },
      HTTP_STATUS.BAD_REQUEST
    )
  }

  try {
    const result = await checkUsernamePolicy(payload.username)
    if (result.status === 'unavailable') {
      return createJsonResponse(
        {
          success: false,
          error: 'Username policy check is temporarily unavailable.',
          status: 'unavailable',
        },
        HTTP_STATUS.SERVICE_UNAVAILABLE
      )
    }

    return apiSuccess(result)
  } catch {
    return apiError(
      'Username policy check is temporarily unavailable.',
      HTTP_STATUS.SERVICE_UNAVAILABLE
    )
  }
}
