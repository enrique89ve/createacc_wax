import type { APIRoute } from 'astro'
import { issueTimingToken } from '@/lib/pow'
import { resolveClientIp } from '@/lib/client-ip'
import { checkCreationRateLimit, createRateLimitResponse } from '@/lib/creation-rate-limiter'

export const GET: APIRoute = (context) => {
	const clientIp = resolveClientIp(context)
	const rateLimit = checkCreationRateLimit('powChallenge', clientIp)
	if (!rateLimit.allowed) {
		return createRateLimitResponse(rateLimit.retryAfterMs)
	}

	const timingTokenId = issueTimingToken()

	return new Response(JSON.stringify({ timingTokenId }), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	})
}
