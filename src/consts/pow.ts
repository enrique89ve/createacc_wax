/**
 * Proof of Work (PoW) anti-spam configuration.
 *
 * Complements IP-based rate limiting with a computational cost per request.
 * The client must solve a SHA-256 puzzle before accessing protected endpoints.
 */

/** Number of leading zero bits required in the hash. 2^18 = ~262K hashes (~1s on mobile). */
export const DIFFICULTY = 18

/** Challenge validity window in milliseconds (5 minutes). */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000

/** Cleanup interval for expired challenges (3 minutes). */
export const CLEANUP_INTERVAL_MS = 3 * 60 * 1000

/** Maximum number of challenges stored in memory before forced eviction. */
export const MAX_STORE_ENTRIES = 50_000

/**
 * Timing Token Anti-Bot: minimum time (ms) a user must spend on page before submit.
 * Each key maps to an endpoint that requires timing validation.
 */
export const TIMING_THRESHOLDS = {
	ticket: 3_000,
	session: 5_000,
	account: 1_000,
} as const

/** Timing token validity window in milliseconds (10 minutes). */
export const TIMING_TOKEN_TTL_MS = 10 * 60 * 1000

/** Maximum number of timing tokens stored in memory before forced eviction. */
export const MAX_TIMING_ENTRIES = 10_000
