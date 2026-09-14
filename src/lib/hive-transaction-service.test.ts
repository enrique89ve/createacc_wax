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

const ORIGINAL_TX = process.env.HIVE_TX_MODE

afterEach(() => {
	if (ORIGINAL_TX === undefined) delete process.env.HIVE_TX_MODE
	else process.env.HIVE_TX_MODE = ORIGINAL_TX
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

describe('HiveTransactionService broadcast spy', () => {
	it('never broadcasts in simulate mode', async () => {
		process.env.HIVE_TX_MODE = 'simulate'
		const broadcast = vi.fn().mockResolvedValue(undefined)
		const tx = createTxMock()
		const chain = {
			createTransaction: async () => tx,
			endpointUrl: 'https://api.hive.blog',
			broadcast,
		} as unknown as IHiveChainInterface

		const service = HiveTransactionService.create(
			{ account: 'creator', privateKey: '5secret', walletName: 'test' },
			{
				getChain: async () => chain,
				broadcast: async () => ({ broadcasted: false }),
			}
		)

		const result = await service.executeTransaction((built) => {
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
		const chain = {
			createTransaction: async () => tx,
			endpointUrl: 'https://api.hive.blog',
			broadcast,
		} as unknown as IHiveChainInterface

		const service = HiveTransactionService.create(
			{ account: 'creator', privateKey: '5secret', walletName: 'test' },
			{
				getChain: async () => chain,
				broadcast: async () => ({ broadcasted: false }),
			}
		)

		const result = await service.executeTransaction((built) => {
			built.validate()
		})

		expect(result.broadcasted).toBe(false)
		expect(broadcast).not.toHaveBeenCalled()
	})
})
