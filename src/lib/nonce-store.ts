/**
 * Shared nonce store for Keychain challenge/response authentication
 * Separated from the endpoint to ensure the same Map instance is used
 * across both the challenge generator and the nonce consumer.
 */

import { randomBytes } from 'node:crypto'

interface NonceEntry {
	readonly nonce: string
	readonly createdAt: number
}

const NONCE_TTL_MS = 2 * 60 * 1000 // 2 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

const CHALLENGE_RATE_LIMIT = {
	MAX_REQUESTS: 10,
	WINDOW_MS: 60 * 1000, // 1 minute
	MAX_ENTRIES: 10_000, // IP limit in memory
} as const

interface RateLimitEntry {
	count: number
	windowStart: number
}

const nonceStore = new Map<string, NonceEntry>()
const rateLimitStore = new Map<string, RateLimitEntry>()

/**
 * Cleans up expired nonces and rate limit entries
 */
function cleanupExpiredEntries(): void {
	const now = Date.now()
	for (const [key, entry] of nonceStore) {
		if (now - entry.createdAt > NONCE_TTL_MS) {
			nonceStore.delete(key)
		}
	}
	for (const [ip, entry] of rateLimitStore) {
		if (now - entry.windowStart > CHALLENGE_RATE_LIMIT.WINDOW_MS) {
			rateLimitStore.delete(ip)
		}
	}
}

// Automatic periodic cleanup (unref to not block shutdown in serverless)
setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS).unref()

/**
 * Generates a cryptographic nonce and stores it
 */
export function generateNonce(): { nonce: string; expiresAt: number } {
	const nonce = randomBytes(32).toString('hex')
	const createdAt = Date.now()

	nonceStore.set(nonce, { nonce, createdAt })

	return { nonce, expiresAt: createdAt + NONCE_TTL_MS }
}

/**
 * Validates and consumes a nonce: exists, not expired.
 * Removes it immediately from the store (one-time use, frees memory).
 */
export function consumeNonce(nonce: string): boolean {
	const entry = nonceStore.get(nonce)
	if (!entry) return false

	nonceStore.delete(nonce)

	const now = Date.now()
	if (now - entry.createdAt > NONCE_TTL_MS) {
		return false
	}

	return true
}

/**
 * Evicts expired entries when the store exceeds MAX_ENTRIES.
 * If it still exceeds after cleanup, clears everything to prevent OOM.
 */
function evictIfNeeded(): void {
	if (rateLimitStore.size <= CHALLENGE_RATE_LIMIT.MAX_ENTRIES) return

	const now = Date.now()
	for (const [ip, entry] of rateLimitStore) {
		if (now - entry.windowStart > CHALLENGE_RATE_LIMIT.WINDOW_MS) {
			rateLimitStore.delete(ip)
		}
	}

	if (rateLimitStore.size > CHALLENGE_RATE_LIMIT.MAX_ENTRIES) {
		rateLimitStore.clear()
	}
}

/**
 * Verifies rate limit for challenge generation.
 * Sliding window: MAX_REQUESTS por WINDOW_MS por IP.
 * @returns true if the request is allowed, false if it exceeds the limit
 */
export function checkChallengeRateLimit(clientIp: string): boolean {
	evictIfNeeded()

	const now = Date.now()
	const entry = rateLimitStore.get(clientIp)

	if (!entry || now - entry.windowStart > CHALLENGE_RATE_LIMIT.WINDOW_MS) {
		rateLimitStore.set(clientIp, { count: 1, windowStart: now })
		return true
	}

	if (entry.count >= CHALLENGE_RATE_LIMIT.MAX_REQUESTS) {
		return false
	}

	entry.count++
	return true
}
