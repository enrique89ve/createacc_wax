import type { APIRoute } from 'astro'
import {
  checkCreationRateLimit,
  createRateLimitResponse,
} from '@/lib/creation-rate-limiter'
import { checkUsernamePolicy } from '@/lib/username-policy'
import { resolveClientIp } from '@/lib/client-ip'

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const POST: APIRoute = async context => {
  const rateLimit = checkCreationRateLimit('username', resolveClientIp(context))
  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit.retryAfterMs)
  }

  try {
    const payload: unknown = await context.request.json()
    if (
      !isRecord(payload) ||
      typeof payload.username !== 'string' ||
      !payload.username.trim()
    ) {
      return Response.json(
        { error: 'Invalid username', status: 'invalid_request' },
        { status: 400, headers: NO_CACHE_HEADERS }
      )
    }

    const result = await checkUsernamePolicy(payload.username)
    if (result.status === 'unavailable') {
      return Response.json(
        { status: 'unavailable' },
        { status: 503, headers: NO_CACHE_HEADERS }
      )
    }

    return Response.json(result, { status: 200, headers: NO_CACHE_HEADERS })
  } catch {
    return Response.json(
      { status: 'unavailable' },
      { status: 503, headers: NO_CACHE_HEADERS }
    )
  }
}
