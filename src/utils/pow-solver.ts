/**
 * Client-side Proof of Work solver using Web Crypto API.
 *
 * Solves SHA-256 puzzles issued by GET /api/pow/challenge.
 * Processes nonces in batches to avoid blocking the main thread.
 */

import { z } from 'astro/zod'
import { readApiResponse } from '@/utils/api-client'

interface PowChallenge {
  readonly challengeId: string
  readonly prefix: string
  readonly difficulty: number
  readonly expiresAt: number
}

const PowChallengeSchema = z.looseObject({
  challengeId: z.string().min(1),
  prefix: z.string().min(1),
  difficulty: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
})

const TimingTokenSchema = z.looseObject({
  timingTokenId: z.string().min(1),
})

export interface PowSolution {
  readonly challengeId: string
  readonly nonce: string
}

/**
 * Adaptive batch size based on device memory.
 * Larger = fewer microtask boundaries = faster.
 * Lower-end devices use smaller batches to reduce GC pressure.
 *
 * navigator.deviceMemory returns approximate RAM in GB (0.25, 0.5, 1, 2, 4, 8).
 * Unsupported browsers default to conservative 2048.
 */
const BATCH_SIZE = (() => {
  const memoryGB = (navigator as { deviceMemory?: number }).deviceMemory
  if (memoryGB === undefined) return 2048
  if (memoryGB <= 1) return 1024
  if (memoryGB <= 2) return 2048
  return 4096
})()
const POW_CHALLENGE_ENDPOINT = '/api/pow/challenge'
const TIMING_TOKEN_ENDPOINT = '/api/pow/timing'

/** Timeout per fetch attempt (generous for slow connections). */
const FETCH_TIMEOUT_MS = 15_000
/** Maximum retry attempts before giving up. */
const MAX_RETRIES = 2
/** Base delay between retries (doubles each attempt). */
const RETRY_BASE_DELAY_MS = 1_000

/**
 * Fetch with timeout + retry for flaky/slow connections.
 * Retries on network errors and 5xx responses with exponential backoff.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)

      if (response.ok) return response

      // Retry on server errors, fail fast on client errors
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        lastError = new Error(`Server error: ${response.status}`)
        continue
      }

      throw new Error(`Fetch failed: ${response.status}`)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        lastError = new Error('Request timed out')
      } else if (error instanceof Error) {
        lastError = error
      }

      if (attempt === MAX_RETRIES) break
    }
  }

  throw lastError ?? new Error('Fetch failed after retries')
}

/**
 * Fetches a fresh PoW challenge from the server.
 */
async function fetchPowChallenge(): Promise<PowChallenge> {
  const response = await fetchWithRetry(POW_CHALLENGE_ENDPOINT)
  const parsedResponse = await readApiResponse(response, PowChallengeSchema)
  if (!parsedResponse.ok) {
    throw new Error('Invalid PoW challenge response')
  }
  return parsedResponse.data
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
 * Fires all digests in a batch via Promise.all (1 microtask boundary
 * per batch instead of BATCH_SIZE), then yields to the event loop.
 */
async function solvePowChallenge(
  challenge: PowChallenge
): Promise<PowSolution> {
  if (!crypto?.subtle) {
    throw new Error('Web Crypto API not available')
  }

  const encoder = new TextEncoder()
  let counter = 0

  while (true) {
    if (Date.now() >= challenge.expiresAt) {
      throw new Error('PoW challenge expired')
    }

    // Prepare batch: encode all inputs and fire digests in parallel
    const nonces: string[] = new Array(BATCH_SIZE)
    const digests: Promise<ArrayBuffer>[] = new Array(BATCH_SIZE)

    for (let i = 0; i < BATCH_SIZE; i++) {
      const nonce = (counter + i).toString(16)
      nonces[i] = nonce
      digests[i] = crypto.subtle.digest(
        'SHA-256',
        encoder.encode(challenge.prefix + nonce)
      )
    }

    // Single microtask boundary for the entire batch
    const results = await Promise.all(digests)

    // Check results sequentially (early return on match)
    for (let i = 0; i < results.length; i++) {
      if (
        hasLeadingZeroBits(new Uint8Array(results[i]), challenge.difficulty)
      ) {
        return { challengeId: challenge.challengeId, nonce: nonces[i] }
      }
    }

    counter += BATCH_SIZE

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
  const response = await fetchWithRetry(TIMING_TOKEN_ENDPOINT)
  const parsedResponse = await readApiResponse(response, TimingTokenSchema)
  if (!parsedResponse.ok) {
    throw new Error('Invalid timing token response')
  }
  return parsedResponse.data.timingTokenId
}

/**
 * Convenience: fetches a challenge and solves it in one call.
 */
export async function obtainPowSolution(): Promise<PowSolution> {
  const challenge = await fetchPowChallenge()
  return solvePowChallenge(challenge)
}
