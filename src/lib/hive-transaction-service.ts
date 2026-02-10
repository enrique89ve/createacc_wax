import { hiveChain, isMainnet } from '@/lib/hiveservice'
import { BeekeeperService } from '@/lib/create/beekeeper-service'
import type { ITransactionBase, ITransaction } from '@hiveio/wax'
import type { IBeekeeperUnlockedWallet } from '@hiveio/beekeeper'
import { getEnvString } from '@/lib/env'
import { ENV_KEYS, ERROR_CONFIG } from '@/consts/constants'
import { shouldRetryWaxError } from '@/lib/wax-error-utils'

export interface IHiveTransactionConfig {
  readonly account: string
  readonly privateKey: string
  readonly maxRetries?: number
  readonly retryDelayMs?: number
}

export type OperationBuilder = (tx: ITransaction, account: string) => void

interface RetryConfig {
  readonly maxRetries: number
  readonly retryDelayMs: number
}

export class HiveTransactionService {
  private readonly retryConfig: RetryConfig

  constructor(private readonly config: IHiveTransactionConfig) {
    this.retryConfig = {
      maxRetries: config.maxRetries ?? ERROR_CONFIG.MAX_RETRY_ATTEMPTS,
      retryDelayMs: config.retryDelayMs ?? ERROR_CONFIG.RETRY_DELAY_MS,
    }
  }

  static create(config: IHiveTransactionConfig): HiveTransactionService {
    return new HiveTransactionService(config)
  }

  /**
   * Sleep helper para delays en retry logic
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async executeTransaction(
    operationBuilder: OperationBuilder,
    successMessage?: string
  ): Promise<{ id: string }> {
    const beekeeperService = BeekeeperService.create({
      privateKey: this.config.privateKey,
    })

    let wallet: IBeekeeperUnlockedWallet | undefined
    let publicKey: string | undefined

    try {
      const walletSession = await beekeeperService.createWalletSession()
      wallet = walletSession.wallet
      publicKey = walletSession.publicKey

      return await this.executeWithRetry(async () => {
        const chain = await hiveChain()

        try {
          const tx = await chain.createTransaction()

          operationBuilder(tx, this.config.account)

          // Validate transaction using Wax native validation
          tx.validate()

          // Ensure wallet and publicKey are defined before signing
          if (!wallet || !publicKey) {
            throw new Error('Wallet or public key is not available')
          }

          // Sign the transaction with the beekeeper wallet
          const signature = wallet.signDigest(publicKey, tx.sigDigest)
          tx.addSignature(signature)

          tx.toApi()

          if (isMainnet()) {
            await chain.broadcast(tx)
          }

          // Capture ID before deleting chain (tx.id uses WASM internally)
          return { id: tx.id }
        } finally {
          chain.delete()
        }
      })
    } finally {
      // Asegurar que el wallet se bloquee siempre, incluso si hubo error en la creación
      if (wallet) {
        try {
          wallet.lock()
        } catch (lockError) {}
      }
    }
  }

  /**
   * Ejecuta una operación con retry logic para errores de red
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        // Usar utilidad centralizada para determinar si es retryable
        const isRetryable = shouldRetryWaxError(error)

        if (!isRetryable || attempt === this.retryConfig.maxRetries) {
          throw error
        }

        // Delay exponencial para el siguiente intento
        const delay = this.retryConfig.retryDelayMs * Math.pow(2, attempt)
        await this.sleep(delay)
      }
    }

    throw new Error('Unexpected: retry loop exited without result')
  }
}

// Roles soportados para factoría genérica
export type HiveServiceRole = 'creator' | 'delegator'

interface EnvConfigMapEntry {
  readonly accountVar: string
  readonly keyVar: string
}

// Mapa centralizado para evitar duplicación de nombres de variables
const ENV_CONFIG_MAP: Record<HiveServiceRole, EnvConfigMapEntry> = {
  creator: {
    accountVar: ENV_KEYS.HIVE_CREATOR_ACCOUNT,
    keyVar: ENV_KEYS.HIVE_CREATOR_ACTIVE_KEY,
  },
  delegator: {
    accountVar: ENV_KEYS.HIVE_DELEGATOR_ACCOUNT,
    keyVar: ENV_KEYS.HIVE_DELEGATOR_ACTIVE_KEY,
  },
} as const

export const createServiceFromEnv = (
  role: HiveServiceRole
): HiveTransactionService => {
  const { accountVar, keyVar } = ENV_CONFIG_MAP[role]
  return HiveTransactionService.create({
    account: getEnvString(accountVar),
    privateKey: getEnvString(keyVar),
  })
}

// Wrappers legacy mantenidos para compatibilidad externa
export const createCreatorService = (): HiveTransactionService =>
  createServiceFromEnv('creator')
export const createDelegatorService = (): HiveTransactionService =>
  createServiceFromEnv('delegator')
