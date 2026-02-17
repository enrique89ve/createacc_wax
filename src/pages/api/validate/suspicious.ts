import type { APIRoute } from 'astro'
import { isSuspiciousUsername } from '@/utils/suspicious-username'
import { checkCreationRateLimit, createRateLimitResponse } from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'

interface SuspiciousValidationRequest {
	readonly username: string
}

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

		const data: SuspiciousValidationRequest = await request.json()
		const { username } = data

		if (!username || typeof username !== 'string') {
			return new Response(
				JSON.stringify({ error: 'Username es requerido' }),
				{
					status: 400,
					headers: {
						'Content-Type': 'application/json',
						'Cache-Control': 'no-store',
					},
				}
			)
		}

		const suspicious = isSuspiciousUsername(username)

		return new Response(
			JSON.stringify({ isSuspicious: suspicious }),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-store',
				},
			}
		)
	} catch (_error) {
		return new Response(
			JSON.stringify({
				error: 'Error interno del servidor',
				isSuspicious: true,
			}),
			{
				status: 500,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-store',
				},
			}
		)
	}
}
