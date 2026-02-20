import { type IHiveChainInterface, type TAccountName } from '@hiveio/wax'
import { BLOCKCHAIN_VERIFICATION_CONFIG } from '@/consts/constants'

interface ValidateAccountParams {
  readonly chain: IHiveChainInterface
  readonly accountName: TAccountName
}

export const validateHiveAccountExists = async ({
  chain,
  accountName,
}: ValidateAccountParams): Promise<boolean> => {
  try {
    const accountData = await chain.api.database_api.find_accounts({
      accounts: [accountName],
      delayed_votes_active: true,
    })

    return accountData.accounts.length > 0
  } catch (error) {

    return false
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
interface PollingResult {
  found: boolean
  attempts: number
  totalTimeMs: number
  timedOut: boolean
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
  while (attempt < finalConfig.maxAttempts) {
    attempt++

    // Check global timeout
    const elapsed = Date.now() - startTime
    if (elapsed > finalConfig.timeoutMs) {

      return {
        found: false,
        attempts: attempt - 1,
        totalTimeMs: elapsed,
        timedOut: true,
      }
    }

    try {
      const accountExists = await validateHiveAccountExists({
        chain,
        accountName,
      })

      if (accountExists) {
        const totalTime = Date.now() - startTime
        return {
          found: true,
          attempts: attempt,
          totalTimeMs: totalTime,
          timedOut: false,
        }
      }

      // Not found, wait before next attempt (except last)
      if (attempt < finalConfig.maxAttempts) {
        await delay(currentDelay)

        // Exponential backoff with maximum limit
        currentDelay = Math.min(
          currentDelay * finalConfig.backoffMultiplier,
          finalConfig.maxDelayMs
        )
      }
    } catch (error) {

      // In case of error, also apply backoff before retrying
      if (attempt < finalConfig.maxAttempts) {
        await delay(currentDelay)
        currentDelay = Math.min(
          currentDelay * finalConfig.backoffMultiplier,
          finalConfig.maxDelayMs
        )
      }
    }
  }

  const totalTime = Date.now() - startTime

  return {
    found: false,
    attempts: attempt,
    totalTimeMs: totalTime,
    timedOut: false,
  }
}
