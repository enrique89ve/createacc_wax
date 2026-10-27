import type { APIRoute } from 'astro'
import { handleInviteAuthRequest } from '@/lib/invite/auth-handler'
import {
  checkCreationRateLimit,
  createRateLimitResponse,
} from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'
import { logger } from '@/lib/logger'

export const ALL: APIRoute = async context => {
  const limit = checkCreationRateLimit('inviteAuth', resolveClientIp(context))
  if (!limit.allowed) return createRateLimitResponse(limit.retryAfterMs)
  try {
    const response = await handleInviteAuthRequest(context.request)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  } catch {
    logger.warn('[invite] Social authentication unavailable')
    return Response.json(
      { success: false },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
