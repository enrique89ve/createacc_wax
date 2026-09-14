import type { IHiveChainInterface } from '@hiveio/wax'
import { HIVE_CHAIN_CONFIG } from '@/consts/constants'
import { createFreshChain } from '@/lib/hive-chain-factory'

/**
 * Chain pool with TTL.
 * IHiveChainInterface is stateless for reads (find_accounts, createTransaction).
 * Each createTransaction() returns an independent object, so concurrent use is safe.
 * The pool avoids ~200-400ms of redundant WASM init per request during active usage.
 */
interface CachedChain {
	instance: IHiveChainInterface
	createdAt: number
}

let cachedChain: CachedChain | null = null
let pendingCreation: Promise<IHiveChainInterface> | null = null

function isCacheValid(): boolean {
	return (
		cachedChain !== null &&
		Date.now() - cachedChain.createdAt < HIVE_CHAIN_CONFIG.POOL_TTL_MS
	)
}

function clearChainCache(): void {
	if (cachedChain) {
		try {
			cachedChain.instance.delete()
		} catch {
			/* best-effort WASM cleanup */
		}
		cachedChain = null
	}
}

/**
 * Drops the pooled chain so the next hiveChain() call creates a fresh instance.
 * Call this after a retryable network/API failure.
 */
export function invalidateHiveChain(): void {
	clearChainCache()
}

/**
 * Returns a cached or fresh Hive Chain instance.
 * Chain instances are reused within a 60-second TTL window.
 * Concurrent callers share a single in-flight creation to avoid duplicate WASM init.
 * Callers MUST NOT call chain.delete() - the pool manages lifecycle.
 */
export const hiveChain = async (): Promise<IHiveChainInterface> => {
	if (isCacheValid() && cachedChain) {
		return cachedChain.instance
	}

	if (pendingCreation) return pendingCreation

	pendingCreation = (async () => {
		try {
			clearChainCache()
			const instance = await createFreshChain()
			cachedChain = { instance, createdAt: Date.now() }
			return instance
		} finally {
			pendingCreation = null
		}
	})()

	return pendingCreation
}
