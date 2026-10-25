import type { APIRoute } from 'astro'
import { generatePowChallenge, issueTimingToken } from '@/lib/pow'
import { resolveClientIp } from '@/lib/client-ip'
import {
  checkCreationRateLimit,
  createRateLimitResponse,
} from '@/lib/creation-rate-limiter'
import { apiSuccess } from '@/utils/errorResponse'
import { POW_ENDPOINT_PARAMS } from '@/consts/pow'

export const GET: APIRoute = context => {
  const clientIp = resolveClientIp(context)
  const rateLimit = checkCreationRateLimit('powChallenge', clientIp)
  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit.retryAfterMs)
  }

  const challenge = generatePowChallenge()
  const withTimingToken =
    context.url.searchParams.get(POW_ENDPOINT_PARAMS.includeTimingToken) ===
    POW_ENDPOINT_PARAMS.enabled

  return apiSuccess({
    ...challenge,
    ...(withTimingToken ? { timingTokenId: issueTimingToken() } : {}),
  })
}
