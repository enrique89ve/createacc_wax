import { CHALLENGE_TTL_MS, TIMING_TOKEN_TTL_MS } from '@/consts/pow'

/** Discard pre-solved PoW after 4 min (challenge TTL is 5 min on server). */
export const POW_MAX_AGE_MS = CHALLENGE_TTL_MS - 60_000
export const TIMING_TOKEN_REFRESH_MARGIN_MS = 60_000

export function isTimingTokenFresh(fetchedAt: number): boolean {
  return (
    fetchedAt > 0 &&
    performance.now() - fetchedAt <
      TIMING_TOKEN_TTL_MS - TIMING_TOKEN_REFRESH_MARGIN_MS
  )
}

/**
 * Wait until a timing token has matured (elapsed >= thresholdMs).
 * @param fetchedAt  - monotonic timestamp (ms) when the token response arrived
 * @param thresholdMs - minimum age required by the server
 * @param marginMs   - extra margin for clock skew / jitter (default 100ms)
 */
export async function ensureTimingMatured(
  fetchedAt: number,
  thresholdMs: number,
  marginMs = 100,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error('Timing wait cancelled')
  }
  if (fetchedAt <= 0) return
  const elapsed = performance.now() - fetchedAt
  const required = thresholdMs + marginMs
  if (elapsed < required) {
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => finish(), required - elapsed)
      const abortHandler = (): void => {
        if (signal) {
          finish(
            signal.reason instanceof Error
              ? signal.reason
              : new Error('Timing wait cancelled')
          )
        }
      }

      function finish(error?: Error): void {
        clearTimeout(timeoutId)
        signal?.removeEventListener('abort', abortHandler)
        if (error) reject(error)
        else resolve()
      }

      signal?.addEventListener('abort', abortHandler, { once: true })
      if (signal?.aborted) abortHandler()
    })
  }
}
