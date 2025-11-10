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
 * Configuración para polling exponencial
 */
interface PollingConfig {
  readonly initialDelayMs: number
  readonly maxDelayMs: number
  readonly maxAttempts: number
  readonly backoffMultiplier: number
  readonly timeoutMs: number
}

/**
 * Resultado del polling con información detallada
 */
interface PollingResult {
  found: boolean
  attempts: number
  totalTimeMs: number
  timedOut: boolean
}

/**
 * Función auxiliar para delay con Promise
 */
const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/**
 * Verifica que una cuenta existe en Hive usando polling exponencial backoff
 * Optimizado para manejar propagación variable en la blockchain
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

    // Verificar timeout global
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

      // No encontrada, esperar antes del siguiente intento (excepto último)
      if (attempt < finalConfig.maxAttempts) {
        await delay(currentDelay)

        // Exponential backoff con límite máximo
        currentDelay = Math.min(
          currentDelay * finalConfig.backoffMultiplier,
          finalConfig.maxDelayMs
        )
      }
    } catch (error) {

      // En caso de error, también aplicar backoff antes de reintentar
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
