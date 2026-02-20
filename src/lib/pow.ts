/**
 * Server-side Proof of Work challenge generation and validation.
 *
 * Pattern follows src/lib/nonce-store.ts:
 * - In-memory Map with automatic cleanup via setInterval().unref()
 * - One-time-use challenges (consumed on validation attempt)
 * - TTL-based expiration
 */

import { randomBytes, createHash } from 'node:crypto'
import {
	DIFFICULTY,
	CHALLENGE_TTL_MS,
	CLEANUP_INTERVAL_MS,
	MAX_STORE_ENTRIES,
	TIMING_TOKEN_TTL_MS,
	MAX_TIMING_ENTRIES,
} from '@/consts/pow'

interface ChallengeEntry {
	readonly prefix: string
	readonly createdAt: number
}

export interface PowChallenge {
	readonly challengeId: string
	readonly prefix: string
	readonly difficulty: number
	readonly expiresAt: number
}

export interface PowSolution {
	readonly challengeId: string
	readonly nonce: string
}

const challengeStore = new Map<string, ChallengeEntry>()

/** tokenId → issuedAt timestamp */
const timingStore = new Map<string, number>()

function cleanupExpiredEntries(): void {
	const now = Date.now()
	for (const [id, entry] of challengeStore) {
		if (now - entry.createdAt > CHALLENGE_TTL_MS) {
			challengeStore.delete(id)
		}
	}
	for (const [id, issuedAt] of timingStore) {
		if (now - issuedAt > TIMING_TOKEN_TTL_MS) {
			timingStore.delete(id)
		}
	}
}

setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL_MS).unref()

/**
 * Generates a PoW challenge for the client to solve.
 */
export function generatePowChallenge(): PowChallenge {
	// Evict if store is too large
	if (challengeStore.size >= MAX_STORE_ENTRIES) {
		cleanupExpiredEntries()
		if (challengeStore.size >= MAX_STORE_ENTRIES) {
			const entriesToRemove = Math.floor(MAX_STORE_ENTRIES * 0.1)
			const iterator = challengeStore.keys()
			for (let i = 0; i < entriesToRemove; i++) {
				const next = iterator.next()
				if (next.done) break
				challengeStore.delete(next.value)
			}
		}
	}

	const challengeId = randomBytes(16).toString('hex')
	const prefix = randomBytes(16).toString('hex')
	const createdAt = Date.now()

	challengeStore.set(challengeId, { prefix, createdAt })

	return {
		challengeId,
		prefix,
		difficulty: DIFFICULTY,
		expiresAt: createdAt + CHALLENGE_TTL_MS,
	}
}

/**
 * Checks whether a hash buffer has the required number of leading zero bits.
 */
function hasLeadingZeroBits(hash: Buffer, bits: number): boolean {
	const fullBytes = Math.floor(bits / 8)
	const remainderBits = bits % 8

	for (let i = 0; i < fullBytes; i++) {
		if (hash[i] !== 0) return false
	}

	if (remainderBits > 0) {
		const mask = 0xff << (8 - remainderBits)
		if ((hash[fullBytes] & mask) !== 0) return false
	}

	return true
}

/**
 * Validates and consumes a PoW solution.
 * The challenge is deleted before verification (anti-replay).
 */
export function validatePowSolution(solution: PowSolution): boolean {
	if (!solution.challengeId || !solution.nonce) return false

	const entry = challengeStore.get(solution.challengeId)
	// Consume immediately — prevents replay regardless of outcome
	challengeStore.delete(solution.challengeId)

	if (!entry) return false

	// Check TTL
	const now = Date.now()
	if (now - entry.createdAt > CHALLENGE_TTL_MS) return false

	// Verify SHA-256(prefix + nonce) has required leading zero bits
	const hash = createHash('sha256')
		.update(entry.prefix + solution.nonce)
		.digest()

	return hasLeadingZeroBits(hash, DIFFICULTY)
}

/**
 * Issues a timing token. The server records the issuance timestamp;
 * later validation checks that enough time has elapsed (anti-bot).
 */
export function issueTimingToken(): string {
	if (timingStore.size >= MAX_TIMING_ENTRIES) {
		cleanupExpiredEntries()
		if (timingStore.size >= MAX_TIMING_ENTRIES) {
			const entriesToRemove = Math.floor(MAX_TIMING_ENTRIES * 0.1)
			const iterator = timingStore.keys()
			for (let i = 0; i < entriesToRemove; i++) {
				const next = iterator.next()
				if (next.done) break
				timingStore.delete(next.value)
			}
		}
	}

	const tokenId = randomBytes(16).toString('hex')
	timingStore.set(tokenId, Date.now())
	return tokenId
}

/**
 * Validates and consumes a timing token (anti-replay).
 * Returns true only if `elapsed >= minMs` and `elapsed < TTL`.
 */
export function validateTimingToken(tokenId: string, minMs: number): boolean {
	if (!tokenId) return false

	const issuedAt = timingStore.get(tokenId)
	timingStore.delete(tokenId)

	if (issuedAt === undefined) return false

	const elapsed = Date.now() - issuedAt
	return elapsed >= minMs && elapsed < TIMING_TOKEN_TTL_MS
}
