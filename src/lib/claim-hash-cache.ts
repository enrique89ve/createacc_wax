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
  private creditMappings = new Map<
    string,
    { creditId: number; expiresAt: number }
  >()
  private readonly TTL = 10 * 60 * 1000 // 10 minutes in milliseconds
  private readonly MAX_ENTRIES = 10_000

  /**
   * Generate and store validation hash
   */
  generateHash(
    username: string,
    ticketCode: string,
    creditsAvailable: number
  ): ClaimHashData {
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
      expiresAt: now + this.TTL,
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
   * Validate and consume hash (atomic — for flows without DB transactions)
   */
  validateAndConsume(hash: string, username: string): ClaimHashData | null {
    const hashData = this.validate(hash, username)
    if (!hashData) return null
    this.cache.delete(hash)
    return hashData
  }

  /**
   * Non-destructive validation — hash stays in cache.
   * Use this when the hash must survive a subsequent DB transaction
   * and only be consumed after successful COMMIT.
   */
  validate(hash: string, username: string): ClaimHashData | null {
    this.cleanup()

    const hashData = this.cache.get(hash)
    if (!hashData) return null

    if (hashData.username !== username) return null

    if (Date.now() > hashData.expiresAt) {
      this.cache.delete(hash)
      return null
    }

    return hashData
  }

  /**
   * Consume a previously validated hash.
   * Call ONLY after a successful DB commit to guarantee
   * the user can retry if the transaction rolled back.
   */
  consume(hash: string): boolean {
    return this.cache.delete(hash)
  }

  /**
   * Store an opaque token → creditId mapping.
   * Used to avoid exposing internal DB IDs in claim codes.
   */
  setCreditMapping(opaqueToken: string, creditId: number): void {
    this.creditMappings.set(opaqueToken, {
      creditId,
      expiresAt: Date.now() + this.TTL,
    })
  }

  /**
   * Retrieve and consume the creditId for an opaque token.
   * Returns null if not found or expired.
   */
  getCreditMapping(opaqueToken: string): number | null {
    const mapping = this.creditMappings.get(opaqueToken)
    if (!mapping) return null

    if (Date.now() > mapping.expiresAt) {
      this.creditMappings.delete(opaqueToken)
      return null
    }

    this.creditMappings.delete(opaqueToken)
    return mapping.creditId
  }

  /**
   * Clean expired hashes and credit mappings
   */
  cleanup(): void {
    const now = Date.now()

    for (const [hash, data] of this.cache) {
      if (now > data.expiresAt) {
        this.cache.delete(hash)
      }
    }

    for (const [token, mapping] of this.creditMappings) {
      if (now > mapping.expiresAt) {
        this.creditMappings.delete(token)
      }
    }
  }

  /**
   * Clean entire cache (for testing)
   */
  clear(): void {
    this.cache.clear()
    this.creditMappings.clear()
  }
}

// Singleton instance
const claimHashCache = new ClaimHashCache()

// Automatic cleanup every 5 minutes
setInterval(
  () => {
    claimHashCache.cleanup()
  },
  5 * 60 * 1000
)

export { claimHashCache }
