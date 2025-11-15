import createBeekeeper, {
  type IBeekeeperUnlockedWallet,
  type IBeekeeperWallet,
} from '@hiveio/beekeeper'
import { BEEKEEPER_CONFIG, ERROR_MESSAGES } from '@/consts/constants'

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
      const session = bk.createSession(BEEKEEPER_CONFIG.salt)
      return await this.initializeWallet(session)
    } catch (error) {
      throw new Error(ERROR_MESSAGES.SESSION_CREATION_FAILED)
    }
  }

  private async initializeWallet(session: any): Promise<IWalletSession> {
    try {
      const lockedWallet: IBeekeeperWallet = await session.openWallet(
        BEEKEEPER_CONFIG.WALLET_NAME
      )
      const unlockedWallet = await lockedWallet.unlock(
        BEEKEEPER_CONFIG.WALLET_PASSWORD
      )
      const publicKeys = unlockedWallet.getPublicKeys()

      if (!publicKeys || publicKeys.length === 0) {
        throw new Error(ERROR_MESSAGES.WALLET.NO_PUBLIC_KEYS)
      }

      return { wallet: unlockedWallet, publicKey: publicKeys[0] }
    } catch (openErr) {
      return await this.createNewWallet(session)
    }
  }

  private async createNewWallet(session: any): Promise<IWalletSession> {
    if (!this.config.privateKey) {
      throw new Error(ERROR_MESSAGES.WALLET.PRIVATE_KEY_REQUIRED)
    }

    const { wallet } = await session.createWallet(
      BEEKEEPER_CONFIG.WALLET_NAME,
      BEEKEEPER_CONFIG.WALLET_PASSWORD,
      false
    )
    const publicKey = await wallet.importKey(this.config.privateKey)
    return { wallet, publicKey }
  }
}
