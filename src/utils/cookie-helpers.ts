import { getBooleanEnv } from '@/lib/env'

/**
 * Determine if cookies should use Secure flag based on environment and request
 *
 * Security rules:
 * - Production (MAINNET=TRUE): Always use Secure (HTTPS only)
 * - Development: Use Secure only if request is over HTTPS
 *
 * This prevents "Secure cookie on HTTP" errors in local development
 * while enforcing HTTPS in production.
 *
 * @param request - Optional request object for HTTPS detection
 * @returns true if cookie should use Secure flag
 */
export function shouldUseSecureCookie(request?: Request): boolean {
	const isMainnet = getBooleanEnv('MAINNET')

	// Production: always use Secure
	if (isMainnet) return true

	// Development: check if request is over HTTPS
	if (request) {
		// Check x-forwarded-proto header (common in reverse proxies)
		const xfProto = request.headers.get('x-forwarded-proto') || ''
		const viaHttpsHeader =
			xfProto.split(',')[0]?.trim().toLowerCase() === 'https'

		// Check forwarded header (RFC 7239)
		const forwarded = request.headers.get('forwarded') || ''
		const viaForwarded = /proto=https/i.test(forwarded)

		// Check URL protocol directly
		const url = new URL(request.url)
		const viaUrl = url.protocol === 'https:'

		return viaHttpsHeader || viaForwarded || viaUrl
	}

	// No request context: default to false for dev safety
	return false
}
