import {
	HIVE_BROADCAST_CONFIRM_VALUE,
	HIVE_TX_MODE_VALUES,
	type HiveExecutionMode,
} from '@/consts/hive-execution'
import { ENV_KEYS } from '@/consts/constants'

export class BroadcastDisabledError extends Error {
	constructor(message = 'Hive broadcast is disabled') {
		super(message)
		this.name = 'BroadcastDisabledError'
	}
}

function readProcessEnv(name: string): string {
	const value = process.env[name]
	if (typeof value !== 'string') return ''
	return value.trim()
}

/**
 * Dev default is simulate. Live broadcast is opt-in via env only.
 */
export function getHiveExecutionMode(): HiveExecutionMode {
	const raw = readProcessEnv(ENV_KEYS.HIVE_TX_MODE).toLowerCase()
	if (raw === HIVE_TX_MODE_VALUES.BROADCAST) {
		return HIVE_TX_MODE_VALUES.BROADCAST
	}
	return HIVE_TX_MODE_VALUES.SIMULATE
}

export function isSimulationMode(): boolean {
	return getHiveExecutionMode() === HIVE_TX_MODE_VALUES.SIMULATE
}

export function isBroadcastMode(): boolean {
	return getHiveExecutionMode() === HIVE_TX_MODE_VALUES.BROADCAST
}

export function isBroadcastEnabled(): boolean {
	if (!isBroadcastMode()) return false
	return readProcessEnv(ENV_KEYS.HIVE_BROADCAST_CONFIRM) === HIVE_BROADCAST_CONFIRM_VALUE
}

export function assertBroadcastAllowed(): void {
	if (isBroadcastEnabled()) return
	throw new BroadcastDisabledError(
		'Broadcast requires HIVE_TX_MODE=broadcast and HIVE_BROADCAST_CONFIRM=HIVE_MAINNET'
	)
}

export function assertBroadcastConfig(): void {
	if (!isBroadcastMode()) return
	if (isBroadcastEnabled()) return
	throw new Error(
		'FATAL CONFIGURATION ERROR: HIVE_TX_MODE=broadcast requires HIVE_BROADCAST_CONFIRM=HIVE_MAINNET'
	)
}

assertBroadcastConfig()
