import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IHiveChainInterface, IOnlineTransaction } from '@hiveio/wax'

vi.mock('@/lib/create/beekeeper-service', () => ({
	BeekeeperService: {
		create: () => ({
			createWalletSession: async () => ({
				wallet: { signDigest: () => 'sig' },
				publicKey: 'STM7public',
				cleanup: async () => {},
			}),
		}),
	},
}))

import { HiveTransactionService } from '@/lib/hive-transaction-service'
import { HiveBroadcastAttemptError } from '@/lib/hive-broadcaster'

const ORIGINAL_TX = process.env.HIVE_TX_MODE
const ORIGINAL_CONFIRM = process.env.HIVE_BROADCAST_CONFIRM

afterEach(() => {
	if (ORIGINAL_TX === undefined) delete process.env.HIVE_TX_MODE
	else process.env.HIVE_TX_MODE = ORIGINAL_TX
	if (ORIGINAL_CONFIRM === undefined) delete process.env.HIVE_BROADCAST_CONFIRM
	else process.env.HIVE_BROADCAST_CONFIRM = ORIGINAL_CONFIRM
	vi.restoreAllMocks()
})

function createTxMock(): IOnlineTransaction {
	return {
		validate: vi.fn(),
		performOnChainVerification: vi.fn().mockResolvedValue(undefined),
		requiredAuthorities: { active: new Set(['creator']), posting: new Set(), owner: new Set(), other: [] },
		sigDigest: 'digest',
		addSignature: vi.fn(),
		isSigned: () => true,
		signatureKeys: ['STM7public'],
		generateAuthorityVerificationTrace: vi.fn().mockResolvedValue({
			verificationStatus: { entryAccepted: true, isOpenAuthority: false },
		}),
		id: 'txid',
	} as unknown as IOnlineTransaction
}

function createService(tx: IOnlineTransaction, chainBroadcast: ReturnType<typeof vi.fn>) {
	const chain = {
		createTransaction: async () => tx,
		endpointUrl: 'https://api.hive.blog',
		broadcast: chainBroadcast,
	} as unknown as IHiveChainInterface

	return HiveTransactionService.create(
		{ account: 'creator', privateKey: '5secret', walletName: 'test', maxRetries: 0 },
		{
			getChain: async () => chain,
			broadcast: async () => ({ broadcasted: false }),
		}
	)
}

describe('HiveTransactionService broadcast spy', () => {
	it('never broadcasts in simulate mode', async () => {
		process.env.HIVE_TX_MODE = 'simulate'
		const broadcast = vi.fn().mockResolvedValue(undefined)
		const tx = createTxMock()
		const result = await createService(tx, broadcast).executeTransaction((built) => {
			built.validate()
		})

		expect(result.broadcasted).toBe(false)
		expect(broadcast).not.toHaveBeenCalled()
		expect(result.wax.signed).toBe(true)
		expect(result.wax.authorityVerified).toBe(true)
		expect(result.wax.onChainVerified).toBe(true)
	})

	it('injected noop never broadcasts even when env is live', async () => {
		process.env.HIVE_TX_MODE = 'broadcast'
		process.env.HIVE_BROADCAST_CONFIRM = 'HIVE_MAINNET'
		const broadcast = vi.fn().mockResolvedValue(undefined)
		const tx = createTxMock()
		const result = await createService(tx, broadcast).executeTransaction((built) => {
			built.validate()
		})

		expect(result.broadcasted).toBe(false)
		expect(broadcast).not.toHaveBeenCalled()
	})

	it('validate failure never broadcasts', async () => {
		process.env.HIVE_TX_MODE = 'simulate'
		const broadcast = vi.fn()
		const tx = createTxMock()
		tx.validate = vi.fn(() => {
			throw new Error('validate failed')
		})
		await expect(
			createService(tx, broadcast).executeTransaction(() => {})
		).rejects.toThrow('validate failed')
		expect(broadcast).not.toHaveBeenCalled()
	})

	it('on-chain verification failure never broadcasts', async () => {
		process.env.HIVE_TX_MODE = 'simulate'
		const broadcast = vi.fn()
		const tx = createTxMock()
		tx.performOnChainVerification = vi.fn().mockRejectedValue(new Error('on-chain failed'))
		await expect(
			createService(tx, broadcast).executeTransaction(() => {})
		).rejects.toThrow('on-chain failed')
		expect(broadcast).not.toHaveBeenCalled()
	})

	it('unsigned transaction never broadcasts', async () => {
		process.env.HIVE_TX_MODE = 'simulate'
		const broadcast = vi.fn()
		const tx = createTxMock()
		tx.isSigned = () => false
		await expect(
			createService(tx, broadcast).executeTransaction(() => {})
		).rejects.toThrow('Transaction was not signed')
		expect(broadcast).not.toHaveBeenCalled()
	})

	it('authority failure never broadcasts', async () => {
		process.env.HIVE_TX_MODE = 'simulate'
		const broadcast = vi.fn()
		const tx = createTxMock()
		tx.generateAuthorityVerificationTrace = vi.fn().mockResolvedValue({
			verificationStatus: { entryAccepted: false, isOpenAuthority: false },
		})
		await expect(
			createService(tx, broadcast).executeTransaction(() => {})
		).rejects.toThrow('Authority verification failed')
		expect(broadcast).not.toHaveBeenCalled()
	})

	it('retries a pre-broadcast timeout then broadcasts once', async () => {
		process.env.HIVE_TX_MODE = 'simulate'
		let validates = 0
		const tx = createTxMock()
		tx.validate = vi.fn(() => {
			validates += 1
			if (validates === 1) throw new Error('network timeout')
		})
		const gateway = vi.fn().mockResolvedValue({ broadcasted: false })
		const chainBroadcast = vi.fn()
		const chain = {
			createTransaction: async () => tx,
			endpointUrl: 'https://api.hive.blog',
			broadcast: chainBroadcast,
		} as unknown as IHiveChainInterface
		const service = HiveTransactionService.create(
			{
				account: 'creator',
				privateKey: '5secret',
				walletName: 'test',
				maxRetries: 2,
				retryDelayMs: 1,
			},
			{
				getChain: async () => chain,
				broadcast: gateway,
			}
		)
		await service.executeTransaction(() => {})
		expect(validates).toBe(2)
		expect(gateway).toHaveBeenCalledTimes(1)
		expect(chainBroadcast).not.toHaveBeenCalled()
	})

	it('does not retry after a broadcast timeout', async () => {
		process.env.HIVE_TX_MODE = 'broadcast'
		process.env.HIVE_BROADCAST_CONFIRM = 'HIVE_MAINNET'
		const gateway = vi.fn().mockRejectedValue(new Error('network timeout'))
		const chainBroadcast = vi.fn()
		const tx = createTxMock()
		const chain = {
			createTransaction: async () => tx,
			endpointUrl: 'https://api.hive.blog',
			broadcast: chainBroadcast,
		} as unknown as IHiveChainInterface
		const service = HiveTransactionService.create(
			{
				account: 'creator',
				privateKey: '5secret',
				walletName: 'test',
				maxRetries: 3,
				retryDelayMs: 1,
			},
			{
				getChain: async () => chain,
				broadcast: gateway,
			}
		)
		await expect(service.executeTransaction(() => {})).rejects.toBeInstanceOf(
			HiveBroadcastAttemptError
		)
		expect(gateway).toHaveBeenCalledTimes(1)
		expect(chainBroadcast).not.toHaveBeenCalled()
	})

	it('RC simulation skips on-chain verification and still does not broadcast', async () => {
		process.env.HIVE_TX_MODE = 'simulate'
		const broadcast = vi.fn()
		const tx = createTxMock()
		const result = await createService(tx, broadcast).executeTransaction(
			() => {},
			{ skipOnChainVerification: true }
		)
		expect(tx.performOnChainVerification).not.toHaveBeenCalled()
		expect(result.wax.onChainVerified).toBe(false)
		expect(result.wax.validated).toBe(true)
		expect(result.wax.signed).toBe(true)
		expect(result.broadcasted).toBe(false)
		expect(broadcast).not.toHaveBeenCalled()
	})
})
