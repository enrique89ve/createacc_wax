import createBeekeeper, {
	type IBeekeeperInstance,
	type IBeekeeperSession,
	type IBeekeeperUnlockedWallet,
} from '@hiveio/beekeeper'
import { BEEKEEPER_CONFIG, ERROR_MESSAGES, ENV_KEYS } from '@/consts/constants'
import { getRequiredEnvString } from '@/lib/env'

export interface IWalletSession {
	readonly wallet: IBeekeeperUnlockedWallet
	readonly publicKey: string
	readonly cleanup: () => Promise<void>
}

export interface IBeekeeperServiceConfig {
	readonly privateKey: string
	readonly walletName: string
}

/**
 * Cached beekeeper session per wallet name.
 * Avoids ~50-200ms WASM init per transaction by reusing sessions.
 * Beekeeper's built-in unlockTimeout (default 900s) auto-locks after inactivity.
 */
interface CachedSession {
	readonly bk: IBeekeeperInstance
	readonly session: IBeekeeperSession
	readonly wallet: IBeekeeperUnlockedWallet
	readonly publicKey: string
}

const sessionCache = new Map<string, CachedSession>()

async function destroyCachedSession(walletName: string): Promise<void> {
	const cached = sessionCache.get(walletName)
	if (!cached) return
	sessionCache.delete(walletName)
	try { cached.session.close() } catch { /* may already be closed */ }
	try { await cached.bk.delete() } catch { /* best-effort WASM cleanup */ }
}

export class BeekeeperService {
	private constructor(private readonly config: IBeekeeperServiceConfig) {}

	static create(config: IBeekeeperServiceConfig): BeekeeperService {
		return new BeekeeperService(config)
	}

	async createWalletSession(): Promise<IWalletSession> {
		// Try cached session first
		const cached = sessionCache.get(this.config.walletName)
		if (cached) {
			try {
				// Verify the wallet is still usable (not timed out)
				cached.wallet.getPublicKeys()
				return {
					wallet: cached.wallet,
					publicKey: cached.publicKey,
					cleanup: async () => { /* no-op: pool manages lifecycle */ },
				}
			} catch {
				// Cached session is stale (e.g., unlock timeout), recreate
				await destroyCachedSession(this.config.walletName)
			}
		}

		// Create fresh session
		let bk: IBeekeeperInstance | undefined

		try {
			bk = await createBeekeeper()
			const session = bk.createSession(BEEKEEPER_CONFIG.SESSION_SALT)
			const { wallet, publicKey } = await this.initializeWallet(session)

			// Cache the session for reuse
			sessionCache.set(this.config.walletName, { bk, session, wallet, publicKey })

			return {
				wallet,
				publicKey,
				cleanup: async () => { /* no-op: pool manages lifecycle */ },
			}
		} catch (error) {
			if (bk) {
				try { await bk.delete() } catch { /* best-effort */ }
			}
			throw new Error(
				`${ERROR_MESSAGES.WALLET.SESSION_CREATION_FAILED}: ${error instanceof Error ? error.message : String(error)}`
			)
		}
	}

	private async initializeWallet(
		session: IBeekeeperSession
	): Promise<{ wallet: IBeekeeperUnlockedWallet; publicKey: string }> {
		const password = getRequiredEnvString(ENV_KEYS.BEEKEEPER_WALLET_PASSWORD)

		if (session.hasWallet(this.config.walletName)) {
			return this.openExistingWallet(session, password)
		}

		return this.createNewWallet(session, password)
	}

	private openExistingWallet(
		session: IBeekeeperSession,
		password: string
	): { wallet: IBeekeeperUnlockedWallet; publicKey: string } {
		const lockedWallet = session.openWallet(this.config.walletName)
		const wallet = lockedWallet.unlock(password)
		const publicKeys = wallet.getPublicKeys()

		if (publicKeys.length === 0) {
			throw new Error(ERROR_MESSAGES.WALLET.NO_PUBLIC_KEYS)
		}

		return { wallet, publicKey: publicKeys[0] }
	}

	private async createNewWallet(
		session: IBeekeeperSession,
		password: string
	): Promise<{ wallet: IBeekeeperUnlockedWallet; publicKey: string }> {
		if (!this.config.privateKey) {
			throw new Error(ERROR_MESSAGES.WALLET.PRIVATE_KEY_REQUIRED)
		}

		const { wallet } = await session.createWallet(
			this.config.walletName,
			password,
			false
		)
		const publicKey = await wallet.importKey(this.config.privateKey)
		return { wallet, publicKey }
	}
}
