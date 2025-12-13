/**
 * Server-side rate limiter for login endpoints
 *
 * Protects against brute-force attacks by limiting login attempts
 * per identifier (IP address or username).
 *
 * Uses in-memory Map with automatic cleanup to prevent memory leaks.
 */

interface RateLimitRecord {
	count: number
	resetAt: number
}

interface RateLimitResult {
	allowed: boolean
	remaining: number
	retryAfter?: number
}

const attempts = new Map<string, RateLimitRecord>()

// Configuration
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const CLEANUP_THRESHOLD = 1000

/**
 * Check if a login attempt is allowed
 *
 * @param identifier - Unique identifier (IP address, username, or combination)
 * @returns Object with allowed status, remaining attempts, and retry time if blocked
 */
export function checkLoginRateLimit(identifier: string): RateLimitResult {
	const now = Date.now()
	const record = attempts.get(identifier)

	// Periodic cleanup to prevent memory leaks
	if (attempts.size > CLEANUP_THRESHOLD) {
		for (const [key, val] of attempts) {
			if (now > val.resetAt) {
				attempts.delete(key)
			}
		}
	}

	// First attempt or window expired
	if (!record || now > record.resetAt) {
		attempts.set(identifier, { count: 1, resetAt: now + WINDOW_MS })
		return { allowed: true, remaining: MAX_ATTEMPTS - 1 }
	}

	// Too many attempts
	if (record.count >= MAX_ATTEMPTS) {
		return {
			allowed: false,
			remaining: 0,
			retryAfter: Math.ceil((record.resetAt - now) / 1000),
		}
	}

	// Increment counter
	record.count++
	return { allowed: true, remaining: MAX_ATTEMPTS - record.count }
}

/**
 * Reset rate limit for an identifier (e.g., after successful login)
 *
 * @param identifier - Unique identifier to reset
 */
export function resetRateLimit(identifier: string): void {
	attempts.delete(identifier)
}

/**
 * Get the current rate limit configuration
 */
export const RATE_LIMIT_CONFIG = {
	MAX_ATTEMPTS,
	WINDOW_MS,
	WINDOW_MINUTES: WINDOW_MS / 60000,
} as const
