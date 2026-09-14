import { HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'
import { getHiveExecutionMode, isBroadcastEnabled } from '@/lib/hive-execution-mode'

export interface RuntimeStatus {
	readonly network: 'Hive Mainnet'
	readonly executionLabel: 'Simulation' | 'Live Broadcast'
	readonly executionMode: typeof HIVE_TX_MODE_VALUES.SIMULATE | typeof HIVE_TX_MODE_VALUES.BROADCAST
	readonly broadcastAllowed: boolean
}

export function getRuntimeStatus(): RuntimeStatus {
	const mode = getHiveExecutionMode()
	const isLive = mode === HIVE_TX_MODE_VALUES.BROADCAST && isBroadcastEnabled()

	return {
		network: 'Hive Mainnet',
		executionLabel: isLive ? 'Live Broadcast' : 'Simulation',
		executionMode: mode,
		broadcastAllowed: isLive,
	}
}
