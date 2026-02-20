/**
 * Client-side Proof of Work solver using Web Crypto API.
 *
 * Solves SHA-256 puzzles issued by GET /api/pow/challenge.
 * Processes nonces in batches to avoid blocking the main thread.
 */

interface PowChallenge {
	readonly challengeId: string
	readonly prefix: string
	readonly difficulty: number
	readonly expiresAt: number
}

export interface PowSolution {
	readonly challengeId: string
	readonly nonce: string
}

const BATCH_SIZE = 1000
const POW_CHALLENGE_ENDPOINT = '/api/pow/challenge'
const TIMING_TOKEN_ENDPOINT = '/api/pow/timing'

/**
 * Fetches a fresh PoW challenge from the server.
 */
async function fetchPowChallenge(): Promise<PowChallenge> {
	const response = await fetch(POW_CHALLENGE_ENDPOINT)
	if (!response.ok) {
		throw new Error(`Failed to fetch PoW challenge: ${response.status}`)
	}
	return response.json()
}

/**
 * Checks whether a hash has the required number of leading zero bits.
 */
function hasLeadingZeroBits(hash: Uint8Array, bits: number): boolean {
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
 * Solves a PoW challenge by brute-forcing a nonce that produces
 * a SHA-256 hash with the required leading zero bits.
 *
 * Yields to the event loop between batches to keep the UI responsive.
 */
async function solvePowChallenge(challenge: PowChallenge): Promise<PowSolution> {
	if (!crypto?.subtle) {
		throw new Error('Web Crypto API not available')
	}

	const encoder = new TextEncoder()
	let counter = 0

	while (true) {
		// Check expiration every batch
		if (Date.now() >= challenge.expiresAt) {
			throw new Error('PoW challenge expired')
		}

		for (let i = 0; i < BATCH_SIZE; i++) {
			const nonce = counter.toString(16)
			const data = encoder.encode(challenge.prefix + nonce)
			const hashBuffer = await crypto.subtle.digest('SHA-256', data)
			const hashArray = new Uint8Array(hashBuffer)

			if (hasLeadingZeroBits(hashArray, challenge.difficulty)) {
				return { challengeId: challenge.challengeId, nonce }
			}

			counter++
		}

		// Yield to event loop between batches
		await new Promise<void>(resolve => setTimeout(resolve, 0))
	}
}

/**
 * Fetches only a timing token from the dedicated lightweight endpoint.
 * Used to start the server-side timer on page load without generating
 * an orphaned PoW challenge.
 */
export async function fetchTimingToken(): Promise<string> {
	const response = await fetch(TIMING_TOKEN_ENDPOINT)
	if (!response.ok) {
		throw new Error(`Failed to fetch timing token: ${response.status}`)
	}
	const data: { timingTokenId: string } = await response.json()
	return data.timingTokenId
}

/**
 * Convenience: fetches a challenge and solves it in one call.
 */
export async function obtainPowSolution(): Promise<PowSolution> {
	const challenge = await fetchPowChallenge()
	return solvePowChallenge(challenge)
}
