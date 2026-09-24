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

afterEach(() => {
  if (ORIGINAL_TX === undefined) delete process.env.HIVE_TX_MODE
  else process.env.HIVE_TX_MODE = ORIGINAL_TX
  vi.restoreAllMocks()
})

function createTxMock(): IOnlineTransaction {
  return {
    validate: vi.fn(),
    performOnChainVerification: vi.fn().mockResolvedValue(undefined),
    requiredAuthorities: {
      active: new Set(['creator']),
      posting: new Set(),
      owner: new Set(),
      other: [],
    },
    sigDigest: 'digest',
    addSignature: vi.fn(),
    isSigned: () => true,
    signatureKeys: ['STM7public'],
    transaction: { expiration: '2030-01-01T00:00:00' },
    generateAuthorityVerificationTrace: vi.fn().mockResolvedValue({
      verificationStatus: { entryAccepted: true, isOpenAuthority: false },
    }),
    id: 'txid',
  } as unknown as IOnlineTransaction
}

function createService(
  tx: IOnlineTransaction,
  chainBroadcast: ReturnType<typeof vi.fn>
) {
  const chain = {
    createTransaction: async () => tx,
    endpointUrl: 'https://api.hive.blog',
    broadcast: chainBroadcast,
  } as unknown as IHiveChainInterface

  return HiveTransactionService.create(
    {
      account: 'creator',
      privateKey: '5secret',
      walletName: 'test',
      maxRetries: 0,
    },
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
    const result = await createService(tx, broadcast).executeTransaction(
      built => {
        built.validate()
      }
    )

    expect(result.broadcasted).toBe(false)
    expect(broadcast).not.toHaveBeenCalled()
    expect(result.wax.signed).toBe(true)
    expect(result.wax.authorityVerified).toBe(true)
    expect(result.wax.onChainVerified).toBe(true)
  })

  it('injected noop never broadcasts even when env is live', async () => {
    process.env.HIVE_TX_MODE = 'broadcast'
    const broadcast = vi.fn().mockResolvedValue(undefined)
    const tx = createTxMock()
    const result = await createService(tx, broadcast).executeTransaction(
      built => {
        built.validate()
      }
    )

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
    tx.performOnChainVerification = vi
      .fn()
      .mockRejectedValue(new Error('on-chain failed'))
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
    const chainBroadcast = vi
      .fn()
      .mockRejectedValue(new Error('network timeout'))
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
      }
    )
    await expect(service.executeTransaction(() => {})).rejects.toBeInstanceOf(
      HiveBroadcastAttemptError
    )
    expect(chainBroadcast).toHaveBeenCalledTimes(1)
  })

  it('keeps the execution mode captured at the start of the attempt', async () => {
    process.env.HIVE_TX_MODE = 'broadcast'
    const tx = createTxMock()
    const chain = {
      createTransaction: async () => tx,
      endpointUrl: 'https://api.hive.blog',
      broadcast: vi.fn(),
    } as unknown as IHiveChainInterface
    const gateway = vi.fn(
      async (
        _chain: IHiveChainInterface,
        _tx: IOnlineTransaction,
        mode: 'simulate' | 'broadcast'
      ) => {
        process.env.HIVE_TX_MODE = 'simulate'
        return { broadcasted: mode === 'broadcast' }
      }
    )

    const service = HiveTransactionService.create(
      {
        account: 'creator',
        privateKey: '5secret',
        walletName: 'test',
        maxRetries: 0,
      },
      { getChain: async () => chain, broadcast: gateway }
    )

    const result = await service.executeTransaction(() => {})

    expect(result.mode).toBe('broadcast')
    expect(result.broadcasted).toBe(true)
    expect(gateway).toHaveBeenCalledWith(chain, tx, 'broadcast')
  })

  it('persists the prepared snapshot before broadcasting', async () => {
    process.env.HIVE_TX_MODE = 'simulate'
    const tx = createTxMock()
    const onPrepared = vi.fn().mockResolvedValue(undefined)
    const gateway = vi.fn().mockResolvedValue({ broadcasted: false })
    const chain = {
      createTransaction: async () => tx,
      endpointUrl: 'https://api.hive.blog',
      broadcast: vi.fn(),
    } as unknown as IHiveChainInterface
    const service = HiveTransactionService.create(
      {
        account: 'creator',
        privateKey: '5secret',
        walletName: 'test',
        maxRetries: 0,
      },
      { getChain: async () => chain, broadcast: gateway }
    )
    await service.executeTransaction(() => {}, { onPrepared })
    expect(onPrepared).toHaveBeenCalledTimes(1)
    expect(onPrepared.mock.calls[0]?.[0]?.id).toBe('txid')
    expect(gateway).toHaveBeenCalledTimes(1)
    expect(onPrepared.mock.invocationCallOrder[0]).toBeLessThan(
      gateway.mock.invocationCallOrder[0]
    )
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
