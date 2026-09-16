/**
 * F3 FIX: In-memory rate limiter for public account creation endpoints.
 *
 * Protects /api/create/session, /api/create/keys-hash, and /api/create/account
 * from volumetric abuse. Uses sliding window counters per IP.
 *
 * @limitation Single-server only. For multi-server, replace with Redis.
 */

interface RateWindow {
  count: number
  windowStart: number
}

interface RateLimiterConfig {
  readonly maxRequests: number
  readonly windowMs: number
  readonly maxEntries: number
}

const CREATION_RATE_LIMITS = {
  session: { maxRequests: 10, windowMs: 60_000, maxEntries: 10_000 },
  keysHash: { maxRequests: 10, windowMs: 60_000, maxEntries: 10_000 },
  account: { maxRequests: 5, windowMs: 300_000, maxEntries: 10_000 },
  suspicious: { maxRequests: 10, windowMs: 60_000, maxEntries: 10_000 },
  similarity: { maxRequests: 10, windowMs: 60_000, maxEntries: 10_000 },
  ticket: { maxRequests: 5, windowMs: 60_000, maxEntries: 10_000 },
  powChallenge: { maxRequests: 30, windowMs: 60_000, maxEntries: 10_000 },
} as const satisfies Record<string, RateLimiterConfig>

type EndpointName = keyof typeof CREATION_RATE_LIMITS

const stores = new Map<EndpointName, Map<string, RateWindow>>()

for (const key of Object.keys(CREATION_RATE_LIMITS) as EndpointName[]) {
  stores.set(key, new Map())
}

function evictOldEntries(
  store: Map<string, RateWindow>,
  windowMs: number
): void {
  const now = Date.now()
  for (const [ip, window] of store) {
    if (now - window.windowStart > windowMs * 2) {
      store.delete(ip)
    }
  }
}

// Periodic cleanup every 5 minutes
const CLEANUP_INTERVAL_MS = 300_000
const cleanupInterval = setInterval(() => {
  for (const [endpoint, store] of stores) {
    const config = CREATION_RATE_LIMITS[endpoint]
    evictOldEntries(store, config.windowMs)
  }
}, CLEANUP_INTERVAL_MS)
cleanupInterval.unref()

export interface RateLimitResult {
  readonly allowed: boolean
  readonly remaining: number
  readonly retryAfterMs: number
}

export function checkCreationRateLimit(
  endpoint: EndpointName,
  clientIp: string
): RateLimitResult {
  const config = CREATION_RATE_LIMITS[endpoint]
  const store = stores.get(endpoint)!
  const now = Date.now()
  const ip = clientIp || 'unknown'

  // Evict if store is too large
  if (store.size >= config.maxEntries) {
    evictOldEntries(store, config.windowMs)
    // If still too large after eviction, remove oldest entries
    if (store.size >= config.maxEntries) {
      const entriesToRemove = Math.floor(config.maxEntries * 0.1)
      const iterator = store.keys()
      for (let i = 0; i < entriesToRemove; i++) {
        const next = iterator.next()
        if (next.done) break
        store.delete(next.value)
      }
    }
  }

  const existing = store.get(ip)

  if (!existing || now - existing.windowStart >= config.windowMs) {
    store.set(ip, { count: 1, windowStart: now })
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      retryAfterMs: 0,
    }
  }

  if (existing.count >= config.maxRequests) {
    const retryAfterMs = config.windowMs - (now - existing.windowStart)
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, retryAfterMs),
    }
  }

  existing.count++
  return {
    allowed: true,
    remaining: config.maxRequests - existing.count,
    retryAfterMs: 0,
  }
}

/**
 * Creates a 429 Too Many Requests response
 */
export function createRateLimitResponse(retryAfterMs: number): Response {
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000)
  return new Response(
    JSON.stringify({ error: 'Too many requests. Please try again later.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
        'Cache-Control': 'no-store',
      },
    }
  )
}
