import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  broadcastHiveTransaction,
  HiveBroadcastAttemptError,
  noopHiveBroadcast,
} from '@/lib/hive-broadcaster'
import type { IHiveChainInterface, IOnlineTransaction } from '@hiveio/wax'

const ORIGINAL_TX = process.env.HIVE_TX_MODE

afterEach(() => {
  if (ORIGINAL_TX === undefined) delete process.env.HIVE_TX_MODE
  else process.env.HIVE_TX_MODE = ORIGINAL_TX
})

function mockChain(): IHiveChainInterface {
  return {
    broadcast: vi.fn().mockResolvedValue(undefined),
  } as unknown as IHiveChainInterface
}

describe('hive broadcaster', () => {
  it('T10 simulate never calls chain.broadcast', async () => {
    process.env.HIVE_TX_MODE = 'simulate'
    const chain = mockChain()
    const tx = {} as IOnlineTransaction
    const result = await broadcastHiveTransaction(chain, tx)
    expect(result.broadcasted).toBe(false)
    expect(chain.broadcast).not.toHaveBeenCalled()
  })

  it('T11 unknown mode is simulate and never broadcasts', async () => {
    process.env.HIVE_TX_MODE = 'maybe'
    const chain = mockChain()
    const result = await broadcastHiveTransaction(
      chain,
      {} as IOnlineTransaction
    )
    expect(result.broadcasted).toBe(false)
    expect(chain.broadcast).not.toHaveBeenCalled()
  })

  it('noop never calls chain.broadcast even when live is enabled', async () => {
    process.env.HIVE_TX_MODE = 'broadcast'
    const chain = mockChain()
    const result = await noopHiveBroadcast(chain, {} as IOnlineTransaction)
    expect(result.broadcasted).toBe(false)
    expect(chain.broadcast).not.toHaveBeenCalled()
  })

  it('T12 HIVE_TX_MODE=broadcast enables the gateway', async () => {
    process.env.HIVE_TX_MODE = 'broadcast'
    const chain = mockChain()
    const tx = {} as IOnlineTransaction
    const result = await broadcastHiveTransaction(chain, tx)
    expect(result.broadcasted).toBe(true)
    expect(chain.broadcast).toHaveBeenCalledTimes(1)
    expect(chain.broadcast).toHaveBeenCalledWith(tx)
  })

  it('broadcast timeout is marked as a single attempt, not a retryable pipeline', async () => {
    process.env.HIVE_TX_MODE = 'broadcast'
    const chain = {
      broadcast: vi.fn().mockRejectedValue(new Error('network timeout')),
    } as unknown as IHiveChainInterface
    await expect(
      broadcastHiveTransaction(chain, {} as IOnlineTransaction)
    ).rejects.toBeInstanceOf(HiveBroadcastAttemptError)
    expect(chain.broadcast).toHaveBeenCalledTimes(1)
  })
})
