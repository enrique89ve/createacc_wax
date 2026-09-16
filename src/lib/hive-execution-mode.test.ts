import { afterEach, describe, expect, it } from 'vitest'
import {
	canDelegateResourceCredits,
	getHiveExecutionMode,
	isBroadcastEnabled,
	isSimulationMode,
} from '@/lib/hive-execution-mode'

afterEach(() => {
	delete process.env.HIVE_TX_MODE
})

describe('hive execution mode', () => {
	it('defaults to simulate', () => {
		expect(getHiveExecutionMode()).toBe('simulate')
		expect(isSimulationMode()).toBe(true)
		expect(isBroadcastEnabled()).toBe(false)
	})

	it('treats unknown values as simulate', () => {
		process.env.HIVE_TX_MODE = 'maybe'
		expect(getHiveExecutionMode()).toBe('simulate')
		expect(isBroadcastEnabled()).toBe(false)
	})

	it('enables live broadcast from HIVE_TX_MODE alone', () => {
		process.env.HIVE_TX_MODE = 'broadcast'
		expect(getHiveExecutionMode()).toBe('broadcast')
		expect(isSimulationMode()).toBe(false)
		expect(isBroadcastEnabled()).toBe(true)
	})

	it('delegates RC in simulate without chain confirmation', () => {
		process.env.HIVE_TX_MODE = 'simulate'
		expect(canDelegateResourceCredits(false)).toBe(true)
	})

	it('delegates RC in live only after chain confirmation', () => {
		process.env.HIVE_TX_MODE = 'broadcast'
		expect(canDelegateResourceCredits(false)).toBe(false)
		expect(canDelegateResourceCredits(true)).toBe(true)
	})
})
