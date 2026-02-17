/**
 * Challenge/Nonce endpoint for Keychain authentication
 * Generates a one-time cryptographic nonce to prevent replay attacks
 */

import type { APIRoute } from 'astro'
import { HTTP_STATUS } from '@/consts/constants'
import { generateNonce, checkChallengeRateLimit } from '@/lib/nonce-store'

export const GET: APIRoute = async ({ clientAddress }) => {
	try {
		if (!clientAddress) {
			return new Response(
				JSON.stringify({ error: 'Unable to determine client identity' }),
				{
					status: HTTP_STATUS.FORBIDDEN,
					headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
				}
			)
		}

		if (!checkChallengeRateLimit(clientAddress)) {
			return new Response(
				JSON.stringify({ error: 'Rate limit exceeded' }),
				{
					status: HTTP_STATUS.TOO_MANY_REQUESTS,
					headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
				}
			)
		}

		const { nonce, expiresAt } = generateNonce()

		return new Response(
			JSON.stringify({ nonce, expiresAt }),
			{
				status: HTTP_STATUS.OK,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-store',
				},
			}
		)
	} catch (error) {
		console.error('Error generating challenge nonce:', error)
		return new Response(
			JSON.stringify({ error: 'Error generando challenge' }),
			{
				status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
				headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
			}
		)
	}
}
