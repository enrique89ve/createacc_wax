import { afterEach, describe, expect, it, vi } from 'vitest'
import { broadcastHiveTransaction } from '@/lib/hive-broadcaster'
import { BroadcastDisabledError } from '@/lib/hive-execution-mode'
import { HIVE_BROADCAST_CONFIRM_VALUE } from '@/consts/hive-execution'
import type { IHiveChainInterface, IOnlineTransaction } from '@hiveio/wax'

const ORIGINAL_TX = process.env.HIVE_TX_MODE
const ORIGINAL_CONFIRM = process.env.HIVE_BROADCAST_CONFIRM

afterEach(() => {
	if (ORIGINAL_TX === undefined) delete process.env.HIVE_TX_MODE
	else process.env.HIVE_TX_MODE = ORIGINAL_TX
	if (ORIGINAL_CONFIRM === undefined) delete process.env.HIVE_BROADCAST_CONFIRM
	else process.env.HIVE_BROADCAST_CONFIRM = ORIGINAL_CONFIRM
})

function mockChain(): IHiveChainInterface {
	return {
		broadcast: vi.fn().mockResolvedValue(undefined),
	} as unknown as IHiveChainInterface
}

describe('hive broadcaster', () => {
	it('T10 simulate never calls chain.broadcast', async () => {
		process.env.HIVE_TX_MODE = 'simulate'
		delete process.env.HIVE_BROADCAST_CONFIRM
		const chain = mockChain()
		const tx = {} as IOnlineTransaction
		const result = await broadcastHiveTransaction(chain, tx)
		expect(result.broadcasted).toBe(false)
		expect(chain.broadcast).not.toHaveBeenCalled()
	})

	it('T11 broadcast without confirm is blocked', async () => {
		process.env.HIVE_TX_MODE = 'broadcast'
		delete process.env.HIVE_BROADCAST_CONFIRM
		const chain = mockChain()
		await expect(
			broadcastHiveTransaction(chain, {} as IOnlineTransaction)
		).rejects.toBeInstanceOf(BroadcastDisabledError)
		expect(chain.broadcast).not.toHaveBeenCalled()
	})

	it('T12 broadcast with confirm enables gateway', async () => {
		process.env.HIVE_TX_MODE = 'broadcast'
		process.env.HIVE_BROADCAST_CONFIRM = HIVE_BROADCAST_CONFIRM_VALUE
		const chain = mockChain()
		const tx = {} as IOnlineTransaction
		const result = await broadcastHiveTransaction(chain, tx)
		expect(result.broadcasted).toBe(true)
		expect(chain.broadcast).toHaveBeenCalledTimes(1)
		expect(chain.broadcast).toHaveBeenCalledWith(tx)
	})
})
