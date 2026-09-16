import { createWaxFoundation } from '@hiveio/wax'

type WaxFoundation = Awaited<ReturnType<typeof createWaxFoundation>>

let waxFoundationPromise: Promise<WaxFoundation> | undefined

/**
 * Shared WaxFoundation singleton.
 * Lazy-initialized on first call, reused across all consumers.
 * Recovers from initialization failures by clearing the cache.
 */
export async function getWaxFoundation(): Promise<WaxFoundation> {
  if (!waxFoundationPromise) {
    waxFoundationPromise = createWaxFoundation()
  }

  try {
    return await waxFoundationPromise
  } catch (error) {
    waxFoundationPromise = undefined
    throw error
  }
}

/**
 * Pre-warm the WASM compilation so it's ready when needed.
 * Fires and forgets — errors are silently ignored.
 */
export function prewarmWaxFoundation(): void {
  if (!waxFoundationPromise) {
    waxFoundationPromise = createWaxFoundation()
    waxFoundationPromise.catch(() => {
      waxFoundationPromise = undefined
    })
  }
}
