import type { APIRoute } from 'astro'
import { issueTimingToken, issueTimingTokenPair } from '@/lib/pow'
import { resolveClientIp } from '@/lib/client-ip'
import {
  checkCreationRateLimit,
  createRateLimitResponse,
} from '@/lib/creation-rate-limiter'
import { apiError, apiSuccess } from '@/utils/errorResponse'
import { POW_ENDPOINT_PARAMS, TIMING_TOKEN_PAIR_SIZE } from '@/consts/pow'
import { HTTP_STATUS } from '@/consts/constants'

export const GET: APIRoute = context => {
  const clientIp = resolveClientIp(context)
  const rateLimit = checkCreationRateLimit('powChallenge', clientIp)
  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit.retryAfterMs)
  }

  const count = context.url.searchParams.get(
    POW_ENDPOINT_PARAMS.timingTokenCount
  )
  if (count !== null && count !== String(TIMING_TOKEN_PAIR_SIZE)) {
    return apiError('Invalid timing token count', HTTP_STATUS.BAD_REQUEST)
  }

  if (count === String(TIMING_TOKEN_PAIR_SIZE)) {
    const timingTokenIds = issueTimingTokenPair()
    return apiSuccess({ timingTokenIds })
  }

  const timingTokenId = issueTimingToken()
  return apiSuccess({ timingTokenId })
}
