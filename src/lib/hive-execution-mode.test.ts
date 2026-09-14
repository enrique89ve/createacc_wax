import { afterEach, describe, expect, it } from 'vitest'
import {
	BroadcastDisabledError,
	assertBroadcastAllowed,
	getHiveExecutionMode,
	isBroadcastEnabled,
	isBroadcastMode,
	isSimulationMode,
} from '@/lib/hive-execution-mode'
import { HIVE_BROADCAST_CONFIRM_VALUE, HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'

const ORIGINAL_TX = process.env.HIVE_TX_MODE
const ORIGINAL_CONFIRM = process.env.HIVE_BROADCAST_CONFIRM

afterEach(() => {
	if (ORIGINAL_TX === undefined) delete process.env.HIVE_TX_MODE
	else process.env.HIVE_TX_MODE = ORIGINAL_TX
	if (ORIGINAL_CONFIRM === undefined) delete process.env.HIVE_BROADCAST_CONFIRM
	else process.env.HIVE_BROADCAST_CONFIRM = ORIGINAL_CONFIRM
})

describe('hive execution mode', () => {
	it('T missing env => simulate', () => {
		delete process.env.HIVE_TX_MODE
		expect(getHiveExecutionMode()).toBe(HIVE_TX_MODE_VALUES.SIMULATE)
		expect(isSimulationMode()).toBe(true)
	})

	it('simulate => simulate', () => {
		process.env.HIVE_TX_MODE = 'simulate'
		expect(getHiveExecutionMode()).toBe(HIVE_TX_MODE_VALUES.SIMULATE)
	})

	it('invalid value => simulate', () => {
		process.env.HIVE_TX_MODE = 'live'
		expect(getHiveExecutionMode()).toBe(HIVE_TX_MODE_VALUES.SIMULATE)
	})

	it('broadcast without confirm => disabled', () => {
		process.env.HIVE_TX_MODE = 'broadcast'
		delete process.env.HIVE_BROADCAST_CONFIRM
		expect(isBroadcastMode()).toBe(true)
		expect(isBroadcastEnabled()).toBe(false)
		expect(() => assertBroadcastAllowed()).toThrow(BroadcastDisabledError)
	})

	it('broadcast + confirm => enabled', () => {
		process.env.HIVE_TX_MODE = 'broadcast'
		process.env.HIVE_BROADCAST_CONFIRM = HIVE_BROADCAST_CONFIRM_VALUE
		expect(isBroadcastEnabled()).toBe(true)
		expect(() => assertBroadcastAllowed()).not.toThrow()
	})
})
