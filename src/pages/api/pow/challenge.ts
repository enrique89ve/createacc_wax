import type { APIRoute } from 'astro'
import { generatePowChallenge } from '@/lib/pow'
import { resolveClientIp } from '@/lib/client-ip'
import { checkCreationRateLimit, createRateLimitResponse } from '@/lib/creation-rate-limiter'

export const GET: APIRoute = (context) => {
	const clientIp = resolveClientIp(context)
	const rateLimit = checkCreationRateLimit('powChallenge', clientIp)
	if (!rateLimit.allowed) {
		return createRateLimitResponse(rateLimit.retryAfterMs)
	}

	const challenge = generatePowChallenge()

	return new Response(JSON.stringify(challenge), {
		status: 200,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	})
}
