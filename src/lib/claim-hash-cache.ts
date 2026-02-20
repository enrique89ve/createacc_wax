/**
 * 🔐 CLAIM HASH CACHE
 *
 * In-memory cache system for claim validation hashes
 * Replaces the TempClaimHashes table with a simpler and more efficient solution
 */

import { createHash, randomBytes } from 'crypto'

export interface ClaimHashData {
	username: string
	hash: string
	ticketCode: string
	creditsAvailable: number
	createdAt: number
	expiresAt: number
}

class ClaimHashCache {
	private cache = new Map<string, ClaimHashData>()
	private readonly TTL = 10 * 60 * 1000 // 10 minutes in milliseconds
	private readonly MAX_ENTRIES = 10_000

	/**
	 * Generate and store validation hash
	 */
	generateHash(username: string, ticketCode: string, creditsAvailable: number): ClaimHashData {
		const now = Date.now()
		const randomBytesHex = randomBytes(16).toString('hex')
		const dataToHash = `${username}:${ticketCode}:${now}:${randomBytesHex}`
		const hash = createHash('sha256').update(dataToHash).digest('hex')

		const hashData: ClaimHashData = {
			username,
			hash,
			ticketCode,
			creditsAvailable,
			createdAt: now,
			expiresAt: now + this.TTL
		}

		// Clean expired hashes before adding a new one
		this.cleanup()

		// Evict oldest entries if cache is full to prevent OOM
		if (this.cache.size >= this.MAX_ENTRIES) {
			const entriesToRemove = Math.floor(this.MAX_ENTRIES * 0.1)
			const iterator = this.cache.keys()
			for (let i = 0; i < entriesToRemove; i++) {
				const next = iterator.next()
				if (next.done) break
				this.cache.delete(next.value)
			}
		}

		// Store in cache
		this.cache.set(hash, hashData)

		return hashData
	}

	/**
	 * Validate and consume hash
	 */
	validateAndConsume(hash: string, username: string): ClaimHashData | null {
		// Clean expired
		this.cleanup()

		const hashData = this.cache.get(hash)

		if (!hashData) {
			return null
		}

		// Verify that the username matches
		if (hashData.username !== username) {
			return null
		}

		// Verify that it has not expired
		if (Date.now() > hashData.expiresAt) {
			this.cache.delete(hash)
			return null
		}

		// Consume hash (remove it from cache)
		this.cache.delete(hash)

		return hashData
	}

	/**
	 * Clean expired hashes
	 */
	cleanup(): void {
		const now = Date.now()

		for (const [hash, data] of this.cache) {
			if (now > data.expiresAt) {
				this.cache.delete(hash)
			}
		}
	}

	/**
	 * Clean entire cache (for testing)
	 */
	clear(): void {
		this.cache.clear()
	}
}

// Singleton instance
const claimHashCache = new ClaimHashCache()

// Automatic cleanup every 5 minutes
setInterval(() => {
	claimHashCache.cleanup()
}, 5 * 60 * 1000)

export { claimHashCache }