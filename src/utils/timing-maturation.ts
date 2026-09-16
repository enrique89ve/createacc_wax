import { CHALLENGE_TTL_MS } from '@/consts/pow'

/** Discard pre-solved PoW after 4 min (challenge TTL is 5 min on server). */
export const POW_MAX_AGE_MS = CHALLENGE_TTL_MS - 60_000

/**
 * Wait until a timing token has matured (elapsed >= thresholdMs).
 * @param fetchedAt  - timestamp (ms) when the token was fetched
 * @param thresholdMs - minimum age required by the server
 * @param marginMs   - extra margin for clock skew / jitter (default 100ms)
 */
export async function ensureTimingMatured(
  fetchedAt: number,
  thresholdMs: number,
  marginMs = 100
): Promise<void> {
  if (fetchedAt <= 0) return
  const elapsed = Date.now() - fetchedAt
  const required = thresholdMs + marginMs
  if (elapsed < required) {
    await new Promise(resolve => setTimeout(resolve, required - elapsed))
  }
}
