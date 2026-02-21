import {
  createHiveChain,
  HealthChecker,
  WaxError,
  WaxChainApiError,
  WaxRequestError,
  WaxRequestTimeoutError,
  WaxRequestAbortedByUser,
} from '@hiveio/wax'
import type {
  IHiveChainInterface,
  TScoredEndpoint,
  GetDynamicGlobalPropertiesResponse,
} from '@hiveio/wax'
import { getBooleanEnv } from '@/lib/env'

/**
 * Hybrid failover system "try-default-first + smart-backup"
 * - Always tries default API first
 * - If it fails, uses HealthChecker to choose the best backup
 * - Next request tries default again
 */

// Endpoints configuration
const MAINNET_DEFAULT = 'https://api.hive.blog'
const MAINNET_BACKUPS = [
  'https://api.openhive.network',
  'https://techcoderx.com',
  'https://rpc.mahdiyari.info',
] as const

const TESTNET_API = 'https://api.fake.openhive.network'
const TESTNET_CHAIN_ID =
  '4200000000000000000000000000000000000000000000000000000000000000'

// Constants for HealthChecker
const HEALTH_CHECK_TIMEOUT = 5000
const EVALUATION_DELAY = 1500

export const isMainnet = (): boolean => getBooleanEnv('MAINNET')

/**
 * Type guard helper to check if an object has a property
 */
function hasProperty<K extends PropertyKey>(
  obj: object,
  key: K
): obj is Record<K, unknown> {
  return key in obj
}

/**
 * Type guard to check internal server errors
 * Uses proper type narrowing without any casts
 * @param apiError - The apiError property from WaxChainApiError
 * @returns true if the error is an internal server error
 */
const isInternalServerError = (apiError: object): boolean => {
  // Since WaxChainApiError.apiError is typed as object,
  // we need to safely navigate its structure
  if (!hasProperty(apiError, 'error')) {
    return false
  }

  const errorObj = apiError.error
  if (typeof errorObj !== 'object' || errorObj === null) {
    return false
  }

  if (!hasProperty(errorObj, 'data')) {
    return false
  }

  const dataObj = errorObj.data
  if (typeof dataObj !== 'object' || dataObj === null) {
    return false
  }

  if (!hasProperty(dataObj, 'name')) {
    return false
  }

  // Check for the specific internal error pattern
  return dataObj.name === 'internal_error_exception'
}

/**
 * Classifies errors to determine if failover should be triggered
 * @param error - Captured error
 * @returns true if failover should be attempted, false if business error
 */
const shouldTriggerFailover = (error: unknown): boolean => {
  // Connectivity/network errors that require failover
  if (
    error instanceof WaxRequestError ||
    error instanceof WaxRequestTimeoutError ||
    error instanceof WaxRequestAbortedByUser
  ) {
    return true
  }

  // WaxChainApiError can be server or business error
  // error.apiError is already typed as object from the library
  if (error instanceof WaxChainApiError) {
    return isInternalServerError(error.apiError)
  }

  // Generic WaxError - analyze message to determine type
  if (error instanceof WaxError) {
    const message = error.message.toLowerCase()
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('connection') ||
      message.includes('fetch')
    ) {
      return true
    }
    return false
  }

  // Other errors (native JS) - probably connectivity
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    if (
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('fetch') ||
      message.includes('connection')
    ) {
      return true
    }
  }

  // By default, do not trigger failover for unknown errors
  return false
}

/**
 * Finds the best endpoint using HealthChecker
 */
const findBestBackup = async (backups: readonly string[]): Promise<string> => {
  const healthChecker = new HealthChecker([...backups], HEALTH_CHECK_TIMEOUT)

  try {
    // Create temporary chain only for the first available backup
    const tempChain = await createHiveChain({ apiEndpoint: backups[0] })

    // Register native validator with correct library type
    healthChecker.register(
      tempChain.api.database_api.get_dynamic_global_properties,
      {},
      (data: GetDynamicGlobalPropertiesResponse): true | string => {
        // GetDynamicGlobalPropertiesResponse from @hiveio/wax has the correct type
        return data?.id === 0 ? true : 'invalid dgp'
      }
    )

    // Brief evaluation
    await new Promise<void>(resolve =>
      setTimeout(() => resolve(), EVALUATION_DELAY)
    )

    // Get best endpoint with strong typing
    const endpoints: TScoredEndpoint[] = healthChecker.list()
    const bestEndpoint = endpoints
      .filter(ep => ep.up)
      .sort((a, b) => b.score - a.score)[0]

    if (bestEndpoint) {
      return bestEndpoint.endpointUrl
    }

    throw new Error('No healthy backup found')
  } finally {
    healthChecker.unregisterAll(true)
  }
}

/**
 * Try to connect with backups sequentially (fallback)
 */
const tryBackupsSequentially = async (
  backups: readonly string[]
): Promise<IHiveChainInterface> => {
  for (const endpoint of backups) {
    try {
      return await createHiveChain({ apiEndpoint: endpoint })
    } catch {
      // Continue to next backup
    }
  }
  throw new Error('All backup endpoints failed')
}

/**
 * Chain pool with TTL.
 * IHiveChainInterface is stateless for reads (find_accounts, createTransaction).
 * Each createTransaction() returns an independent object, so concurrent use is safe.
 * The pool avoids ~200-400ms of redundant WASM init per request during active usage.
 */
const CHAIN_TTL_MS = 60_000

interface CachedChain {
	instance: IHiveChainInterface
	createdAt: number
}

let cachedChain: CachedChain | null = null

function isCacheValid(): boolean {
	return cachedChain !== null && (Date.now() - cachedChain.createdAt) < CHAIN_TTL_MS
}

function clearChainCache(): void {
	if (cachedChain) {
		try { cachedChain.instance.delete() } catch { /* best-effort WASM cleanup */ }
		cachedChain = null
	}
}

/**
 * Creates a fresh Hive Chain instance with hybrid failover (no cache).
 * Used internally by the pool and for cache-miss scenarios.
 */
const createFreshChain = async (): Promise<IHiveChainInterface> => {
	// TESTNET: Simple configuration
	if (!isMainnet()) {
		return await createHiveChain({
			chainId: TESTNET_CHAIN_ID,
			apiEndpoint: TESTNET_API,
		})
	}

	// MAINNET: Try-default-first + smart backup
	try {
		return await createHiveChain({ apiEndpoint: MAINNET_DEFAULT })
	} catch (error) {
		if (!shouldTriggerFailover(error)) {
			throw error
		}

		try {
			const bestBackupUrl = await findBestBackup(MAINNET_BACKUPS)
			return await createHiveChain({ apiEndpoint: bestBackupUrl })
		} catch {
			try {
				return await tryBackupsSequentially(MAINNET_BACKUPS)
			} catch {
				throw new Error('All Hive APIs are unavailable')
			}
		}
	}
}

/**
 * Returns a cached or fresh Hive Chain instance.
 * Chain instances are reused within a 60-second TTL window.
 * Callers MUST NOT call chain.delete() - the pool manages lifecycle.
 */
export const hiveChain = async (): Promise<IHiveChainInterface> => {
	if (isCacheValid()) {
		return cachedChain!.instance
	}

	clearChainCache()
	const instance = await createFreshChain()
	cachedChain = { instance, createdAt: Date.now() }
	return instance
}
