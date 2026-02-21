import { hiveChain, isMainnet } from '@/lib/hiveservice'
import { BeekeeperService, type IWalletSession } from '@/lib/create/beekeeper-service'
import type { ITransactionBase } from '@hiveio/wax'
import { getEnvString } from '@/lib/env'
import { BEEKEEPER_CONFIG, ENV_KEYS, ERROR_CONFIG } from '@/consts/constants'
import { shouldRetryWaxError } from '@/lib/wax-error-utils'

export interface IHiveTransactionConfig {
  readonly account: string
  readonly privateKey: string
  readonly walletName: string
  readonly maxRetries?: number
  readonly retryDelayMs?: number
}

export type OperationBuilder = (tx: ITransactionBase, account: string) => void

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
   * Sleep helper for delays in retry logic
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  async executeTransaction(
    operationBuilder: OperationBuilder
  ): Promise<{ id: string }> {
    const beekeeperService = BeekeeperService.create({
      privateKey: this.config.privateKey,
      walletName: this.config.walletName,
    })

    let walletSession: IWalletSession | undefined

    try {
      walletSession = await beekeeperService.createWalletSession()
      const { wallet, publicKey } = walletSession

      return await this.executeWithRetry(async () => {
        const chain = await hiveChain()
        const tx = await chain.createTransaction()

        operationBuilder(tx, this.config.account)

        tx.validate()

        const signature = wallet.signDigest(publicKey, tx.sigDigest)
        tx.addSignature(signature)

        tx.toApi()

        if (isMainnet()) {
          await chain.broadcast(tx)
        }

        return { id: tx.id }
      })
    } finally {
      if (walletSession) {
        await walletSession.cleanup()
      }
    }
  }

  /**
   * Executes an operation with retry logic for network errors
   */
  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        // Use centralized utility to determine if it is retryable
        const isRetryable = shouldRetryWaxError(error)

        if (!isRetryable || attempt === this.retryConfig.maxRetries) {
          throw error
        }

        // Exponential delay for the next attempt
        const delay = this.retryConfig.retryDelayMs * Math.pow(2, attempt)
        await this.sleep(delay)
      }
    }

    throw new Error('Unexpected: retry loop exited without result')
  }
}

// Supported roles for generic factory
export type HiveServiceRole = 'creator' | 'delegator'

interface EnvConfigMapEntry {
  readonly accountVar: string
  readonly keyVar: string
  readonly walletName: string
}

// Centralized map to avoid duplication of variable names
const ENV_CONFIG_MAP: Record<HiveServiceRole, EnvConfigMapEntry> = {
  creator: {
    accountVar: ENV_KEYS.HIVE_CREATOR_ACCOUNT,
    keyVar: ENV_KEYS.HIVE_CREATOR_ACTIVE_KEY,
    walletName: `${BEEKEEPER_CONFIG.WALLET_PREFIX}-creator`,
  },
  delegator: {
    accountVar: ENV_KEYS.HIVE_DELEGATOR_ACCOUNT,
    keyVar: ENV_KEYS.HIVE_DELEGATOR_POSTING_KEY,
    walletName: `${BEEKEEPER_CONFIG.WALLET_PREFIX}-delegator`,
  },
} as const

export const createServiceFromEnv = (
  role: HiveServiceRole
): HiveTransactionService => {
  const { accountVar, keyVar, walletName } = ENV_CONFIG_MAP[role]
  return HiveTransactionService.create({
    account: getEnvString(accountVar),
    privateKey: getEnvString(keyVar),
    walletName,
  })
}

// Legacy wrappers maintained for external compatibility
export const createCreatorService = (): HiveTransactionService =>
  createServiceFromEnv('creator')
export const createDelegatorService = (): HiveTransactionService =>
  createServiceFromEnv('delegator')
