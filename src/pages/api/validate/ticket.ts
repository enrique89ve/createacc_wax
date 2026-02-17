import type { APIRoute } from 'astro'
import { validateTicketInDB } from '@/utils/db-ticket-validator'
import { resolveClientIp } from '@/lib/client-ip'
import { checkCreationRateLimit } from '@/lib/creation-rate-limiter'

/**
 * F5c FIX: Response only returns { valid: boolean } - no ticket code/description.
 * F7 FIX: Cache-Control: no-store on all responses.
 * F8 FIX: Rate-limit via centralized creation-rate-limiter (5 req per 60s per IP).
 */

const NO_CACHE_HEADERS = {
	'Content-Type': 'application/json',
	'Cache-Control': 'no-store',
} as const

export const POST: APIRoute = async (context) => {
	try {
		const clientIp = resolveClientIp(context)
		const rateLimit = checkCreationRateLimit('ticket', clientIp)
		if (!rateLimit.allowed) {
			const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000)
			return new Response(
				JSON.stringify({ valid: false }),
				{
					status: 429,
					headers: {
						...NO_CACHE_HEADERS,
						'Retry-After': String(retryAfterSeconds),
					},
				}
			)
		}

		const data: { ticket?: unknown } = await context.request.json()
		const { ticket } = data

		if (!ticket || typeof ticket !== 'string') {
			return new Response(
				JSON.stringify({ valid: false }),
				{ status: 400, headers: NO_CACHE_HEADERS }
			)
		}

		const validation = await validateTicketInDB(ticket)

		if (!validation.isValid) {
			return new Response(
				JSON.stringify({ valid: false }),
				{ status: 200, headers: NO_CACHE_HEADERS }
			)
		}

		// F5c FIX: Only return validity, not ticket code/description
		return new Response(
			JSON.stringify({ valid: true }),
			{ status: 200, headers: NO_CACHE_HEADERS }
		)
	} catch (_error) {
		return new Response(
			JSON.stringify({ valid: false }),
			{ status: 500, headers: NO_CACHE_HEADERS }
		)
	}
}
