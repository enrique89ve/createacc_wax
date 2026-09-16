import { type IHiveChainInterface, type TAccountName } from '@hiveio/wax'
import { BLOCKCHAIN_VERIFICATION_CONFIG } from '@/consts/constants'

interface ValidateAccountParams {
  readonly chain: IHiveChainInterface
  readonly accountName: TAccountName
}

/**
 * Existence check on Hive (database_api.find_accounts).
 * Not a format check — use checkHiveAccountFormat() / validateAccountName() for characters.
 * Distinguishes "not found" from "RPC error" (avoids false positives).
 *
 * Used client-side in Form.astro. For server-side code, prefer safeCheckAccountOnChain.
 */
export const validateHiveAccountExists = async ({
  chain,
  accountName,
}: ValidateAccountParams): Promise<ChainLookupResult> => {
  try {
    const accountData = await chain.api.database_api.find_accounts({
      accounts: [accountName],
      delayed_votes_active: true,
    })

    return accountData.accounts.length > 0
      ? { status: 'found' }
      : { status: 'not_found' }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown chain error'
    return { status: 'error', message }
  }
}

/**
 * Result type for safe on-chain account lookup.
 * Distinguishes "account not found" from "API error" to prevent
 * incorrect rollbacks when the RPC is temporarily unreachable.
 */
export type ChainLookupResult =
  | { readonly status: 'found' }
  | { readonly status: 'not_found' }
  | { readonly status: 'error'; readonly message: string }

/**
 * Safe variant of validateHiveAccountExists that never swallows errors.
 * Returns a discriminated result so callers can handle network failures
 * differently from "account does not exist".
 */
export async function safeCheckAccountOnChain({
  chain,
  accountName,
}: ValidateAccountParams): Promise<ChainLookupResult> {
  try {
    const accountData = await chain.api.database_api.find_accounts({
      accounts: [accountName],
      delayed_votes_active: true,
    })
    return accountData.accounts.length > 0
      ? { status: 'found' }
      : { status: 'not_found' }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown chain error'
    return { status: 'error', message }
  }
}

/**
 * Configuration for exponential polling
 */
interface PollingConfig {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly maxAttempts: number
  readonly backoffMultiplier: number
  readonly timeoutMs: number
}

/**
 * Polling result with detailed information
 */
export type PollingResult =
  | {
      readonly status: 'found'
      readonly attempts: number
      readonly totalTimeMs: number
      readonly timedOut: boolean
    }
  | {
      readonly status: 'not_found'
      readonly attempts: number
      readonly totalTimeMs: number
      readonly timedOut: boolean
    }
  | {
      readonly status: 'error'
      readonly attempts: number
      readonly totalTimeMs: number
      readonly timedOut: boolean
      readonly message: string
    }

/**
 * Helper function for delay with Promise
 */
const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/**
 * Verifies that an account exists in Hive using exponential backoff polling
 * Optimized to handle variable propagation on the blockchain
 */
export const validateHiveAccountExistsWithPolling = async ({
  chain,
  accountName,
  config = {},
}: ValidateAccountParams & {
  config?: Partial<PollingConfig>
}): Promise<PollingResult> => {
  const finalConfig: PollingConfig = {
    initialDelayMs: BLOCKCHAIN_VERIFICATION_CONFIG.INITIAL_DELAY_MS,
    maxDelayMs: BLOCKCHAIN_VERIFICATION_CONFIG.MAX_DELAY_MS,
    maxAttempts: BLOCKCHAIN_VERIFICATION_CONFIG.MAX_ATTEMPTS,
    backoffMultiplier: BLOCKCHAIN_VERIFICATION_CONFIG.BACKOFF_MULTIPLIER,
    timeoutMs: BLOCKCHAIN_VERIFICATION_CONFIG.TIMEOUT_MS,
    ...config,
  }

  const startTime = Date.now()
  let currentDelay = finalConfig.initialDelayMs
  let attempt = 0
  let hadRpcError = false
  let lastRpcErrorMessage = 'Unknown chain polling error'
  while (attempt < finalConfig.maxAttempts) {
    attempt++

    // Check global timeout
    const elapsed = Date.now() - startTime
    if (elapsed > finalConfig.timeoutMs) {
      return hadRpcError
        ? {
            status: 'error',
            attempts: attempt - 1,
            totalTimeMs: elapsed,
            timedOut: true,
            message: lastRpcErrorMessage,
          }
        : {
            status: 'not_found',
            attempts: attempt - 1,
            totalTimeMs: elapsed,
            timedOut: true,
          }
    }

    const result = await safeCheckAccountOnChain({ chain, accountName })

    if (result.status === 'found') {
      const totalTime = Date.now() - startTime
      return {
        status: 'found',
        attempts: attempt,
        totalTimeMs: totalTime,
        timedOut: false,
      }
    }

    if (result.status === 'error') {
      hadRpcError = true
      lastRpcErrorMessage = result.message
    }

    // Both 'not_found' and 'error' → apply backoff before retrying
    if (attempt < finalConfig.maxAttempts) {
      await delay(currentDelay)
      currentDelay = Math.min(
        currentDelay * finalConfig.backoffMultiplier,
        finalConfig.maxDelayMs
      )
    }
  }

  const totalTime = Date.now() - startTime

  return hadRpcError
    ? {
        status: 'error',
        attempts: attempt,
        totalTimeMs: totalTime,
        timedOut: false,
        message: lastRpcErrorMessage,
      }
    : {
        status: 'not_found',
        attempts: attempt,
        totalTimeMs: totalTime,
        timedOut: false,
      }
}
