import { hiveChain, invalidateHiveChain } from '@/lib/hiveservice'
import { BeekeeperService, type IWalletSession } from '@/lib/create/beekeeper-service'
import type { IHiveChainInterface, IOnlineTransaction } from '@hiveio/wax'
import { getEnvString } from '@/lib/env'
import { BEEKEEPER_CONFIG, ENV_KEYS, ERROR_CONFIG } from '@/consts/constants'
import { shouldRetryWaxError } from '@/lib/wax-error-utils'
import {
	broadcastHiveTransaction,
	HiveBroadcastAttemptError,
	type HiveBroadcaster,
} from '@/lib/hive-broadcaster'
import { getHiveExecutionMode } from '@/lib/hive-execution-mode'
import type { HiveTransactionResult, HiveWaxPipelineStatus } from '@/types/hive-transaction'

export interface IHiveTransactionConfig {
	readonly account: string
	readonly privateKey: string
	readonly walletName: string
	readonly maxRetries?: number
	readonly retryDelayMs?: number
}

export type OperationBuilder = (tx: IOnlineTransaction, account: string) => void

export interface PreparedTransactionSnapshot {
	readonly id: string
	readonly wax: HiveWaxPipelineStatus
	readonly requiredAuthorities: unknown
	readonly signaturePublicKeys: string[]
}

export interface ExecuteTransactionOptions {
	readonly skipOnChainVerification?: boolean
	readonly onPrepared?: (snapshot: PreparedTransactionSnapshot) => Promise<void>
}

export interface HiveTransactionRuntime {
	readonly getChain?: () => Promise<IHiveChainInterface>
	readonly broadcast?: HiveBroadcaster
}

interface RetryConfig {
	readonly maxRetries: number
	readonly retryDelayMs: number
}

function isAuthorityAccepted(status: { entryAccepted: boolean }): boolean {
	return status.entryAccepted === true
}

async function validateAndVerifyOnChain(
	tx: IOnlineTransaction,
	skipOnChainVerification: boolean
): Promise<{ validated: boolean; onChainVerified: boolean }> {
	tx.validate()
	if (skipOnChainVerification) {
		return { validated: true, onChainVerified: false }
	}
	await tx.performOnChainVerification()
	return { validated: true, onChainVerified: true }
}

async function signOnlineTransaction(
	tx: IOnlineTransaction,
	walletSession: IWalletSession
): Promise<string[]> {
	const { wallet, publicKey } = walletSession
	const signature = wallet.signDigest(publicKey, tx.sigDigest)
	tx.addSignature(signature)
	if (!tx.isSigned()) {
		throw new Error('Transaction was not signed')
	}
	return [...tx.signatureKeys]
}

async function verifyTransactionAuthority(tx: IOnlineTransaction): Promise<boolean> {
	const trace = await tx.generateAuthorityVerificationTrace()
	return isAuthorityAccepted(trace.verificationStatus)
}

export class HiveTransactionService {
	private readonly retryConfig: RetryConfig

	constructor(
		private readonly config: IHiveTransactionConfig,
		private readonly runtime: HiveTransactionRuntime = {}
	) {
		this.retryConfig = {
			maxRetries: config.maxRetries ?? ERROR_CONFIG.MAX_RETRY_ATTEMPTS,
			retryDelayMs: config.retryDelayMs ?? ERROR_CONFIG.RETRY_DELAY_MS,
		}
	}

	static create(
		config: IHiveTransactionConfig,
		runtime?: HiveTransactionRuntime
	): HiveTransactionService {
		return new HiveTransactionService(config, runtime)
	}

	private async sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms))
	}

	private async resolveChain(): Promise<IHiveChainInterface> {
		if (this.runtime.getChain) return this.runtime.getChain()
		return hiveChain()
	}

	private async dispatchBroadcast(
		chain: IHiveChainInterface,
		tx: IOnlineTransaction
	): Promise<boolean> {
		const broadcast = this.runtime.broadcast ?? broadcastHiveTransaction
		const outcome = await broadcast(chain, tx)
		return outcome.broadcasted
	}

	private async prepareSignedTransaction(
		operationBuilder: OperationBuilder,
		walletSession: IWalletSession,
		options: ExecuteTransactionOptions
	): Promise<{
		chain: IHiveChainInterface
		tx: IOnlineTransaction
		requiredAuthorities: unknown
		signaturePublicKeys: string[]
		wax: HiveTransactionResult['wax']
	}> {
		const chain = await this.resolveChain()
		const tx = await chain.createTransaction()
		operationBuilder(tx, this.config.account)

		const skipOnChain = options.skipOnChainVerification === true
		const waxChecks = await validateAndVerifyOnChain(tx, skipOnChain)
		const requiredAuthorities = tx.requiredAuthorities
		const signaturePublicKeys = await signOnlineTransaction(tx, walletSession)
		const authorityVerified = await verifyTransactionAuthority(tx)
		if (!authorityVerified) {
			throw new Error('Authority verification failed')
		}

		return {
			chain,
			tx,
			requiredAuthorities,
			signaturePublicKeys,
			wax: {
				validated: waxChecks.validated,
				onChainVerified: waxChecks.onChainVerified,
				signed: true,
				authorityVerified,
			},
		}
	}

	async executeTransaction(
		operationBuilder: OperationBuilder,
		options: ExecuteTransactionOptions = {}
	): Promise<HiveTransactionResult> {
		const beekeeperService = BeekeeperService.create({
			privateKey: this.config.privateKey,
			walletName: this.config.walletName,
		})

		let walletSession: IWalletSession | undefined

		try {
			walletSession = await beekeeperService.createWalletSession()
			const prepared = await this.executeWithRetry(() =>
				this.prepareSignedTransaction(
					operationBuilder,
					walletSession as IWalletSession,
					options
				)
			)
			if (options.onPrepared) {
				await options.onPrepared({
					id: prepared.tx.id,
					wax: prepared.wax,
					requiredAuthorities: prepared.requiredAuthorities,
					signaturePublicKeys: prepared.signaturePublicKeys,
				})
			}
			const broadcasted = await this.dispatchBroadcast(prepared.chain, prepared.tx)
			return {
				id: prepared.tx.id,
				mode: getHiveExecutionMode(),
				broadcasted,
				wax: prepared.wax,
				requiredAuthorities: prepared.requiredAuthorities,
				signaturePublicKeys: prepared.signaturePublicKeys,
				endpoint: prepared.chain.endpointUrl,
			}
		} finally {
			if (walletSession) {
				await walletSession.cleanup()
			}
		}
	}

	private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
		for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
			try {
				return await operation()
			} catch (error) {
				if (error instanceof HiveBroadcastAttemptError) throw error
				const isRetryable = shouldRetryWaxError(error)

				if (!isRetryable || attempt === this.retryConfig.maxRetries) {
					throw error
				}

				invalidateHiveChain()
				const delay = this.retryConfig.retryDelayMs * Math.pow(2, attempt)
				await this.sleep(delay)
			}
		}

		throw new Error('Unexpected: retry loop exited without result')
	}
}

export type HiveServiceRole = 'creator' | 'delegator'

interface EnvConfigMapEntry {
	readonly accountVar: string
	readonly keyVar: string
	readonly walletName: string
}

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
	role: HiveServiceRole,
	runtime?: HiveTransactionRuntime
): HiveTransactionService => {
	const { accountVar, keyVar, walletName } = ENV_CONFIG_MAP[role]
	return HiveTransactionService.create(
		{
			account: getEnvString(accountVar),
			privateKey: getEnvString(keyVar),
			walletName,
		},
		runtime
	)
}

export const createCreatorService = (
	runtime?: HiveTransactionRuntime
): HiveTransactionService => createServiceFromEnv('creator', runtime)

export const createDelegatorService = (
	runtime?: HiveTransactionRuntime
): HiveTransactionService => createServiceFromEnv('delegator', runtime)
