import createBeekeeper, {
  type IBeekeeperUnlockedWallet,
  type IBeekeeperWallet,
} from '@hiveio/beekeeper'
import { BEEKEEPER_CONFIG, ERROR_MESSAGES } from '@/consts/constants'
import { getRequiredEnvString } from '@/lib/env'
import { ENV_KEYS } from '@/consts/constants'

export interface IWalletSession {
  readonly wallet: IBeekeeperUnlockedWallet
  readonly publicKey: string
}

export interface IBeekeeperServiceConfig {
  readonly privateKey: string
}

export class BeekeeperService {
  private constructor(private readonly config: IBeekeeperServiceConfig) {}

  static create(config: IBeekeeperServiceConfig): BeekeeperService {
    return new BeekeeperService(config)
  }

  async createWalletSession(): Promise<IWalletSession> {
    try {
      const bk = await createBeekeeper()
      const session = bk.createSession(BEEKEEPER_CONFIG.SESSION_SALT)
      return await this.initializeWallet(session)
    } catch (error) {
      throw new Error(
        `${ERROR_MESSAGES.WALLET.SESSION_CREATION_FAILED}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  private async initializeWallet(session: any): Promise<IWalletSession> {
    try {
      const lockedWallet: IBeekeeperWallet = await session.openWallet(
        BEEKEEPER_CONFIG.WALLET_NAME
      )
      const unlockedWallet = await lockedWallet.unlock(
        getRequiredEnvString(
          ENV_KEYS.BEEKEEPER_WALLET_PASSWORD as keyof ImportMetaEnv
        )
      )
      const publicKeys = unlockedWallet.getPublicKeys()

      if (!publicKeys || publicKeys.length === 0) {
        throw new Error(ERROR_MESSAGES.WALLET.NO_PUBLIC_KEYS)
      }

      return { wallet: unlockedWallet, publicKey: publicKeys[0] }
    } catch (openErr) {
      try {
        return await this.createNewWallet(session)
      } catch (createErr: any) {
        // Si falla la creación porque ya existe, el error crítico es el de apertura (openErr)
        // Esto nos revelará por qué no se pudo abrir la wallet existente (ej: password incorrecto, archivo corrupto, lock)
        if (
          createErr?.message?.includes('already exists') ||
          String(createErr).includes('already exists')
        ) {
          console.error(`[Beekeeper] Failed to open existing wallet:`, openErr)
          throw new Error(
            `${ERROR_MESSAGES.WALLET.SESSION_CREATION_FAILED}: Unable to open existing wallet. Cause: ${openErr instanceof Error ? openErr.message : String(openErr)}`
          )
        }
        throw createErr
      }
    }
  }

  private async createNewWallet(session: any): Promise<IWalletSession> {
    if (!this.config.privateKey) {
      throw new Error(ERROR_MESSAGES.WALLET.PRIVATE_KEY_REQUIRED)
    }

    const { wallet } = await session.createWallet(
      BEEKEEPER_CONFIG.WALLET_NAME,
      getRequiredEnvString(
        ENV_KEYS.BEEKEEPER_WALLET_PASSWORD as keyof ImportMetaEnv
      ),
      false
    )
    const publicKey = await wallet.importKey(this.config.privateKey)
    return { wallet, publicKey }
  }
}
