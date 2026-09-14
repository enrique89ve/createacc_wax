import type { IHiveChainInterface, IOnlineTransaction } from '@hiveio/wax'
import {
	assertBroadcastAllowed,
	isSimulationMode,
} from '@/lib/hive-execution-mode'

export interface HiveBroadcastOutcome {
	readonly broadcasted: boolean
}

export type HiveBroadcaster = (
	chain: IHiveChainInterface,
	tx: IOnlineTransaction
) => Promise<HiveBroadcastOutcome>

/**
 * Diagnostics / self-test only. Never calls chain.broadcast(),
 * regardless of HIVE_TX_MODE.
 */
export async function noopHiveBroadcast(
	_chain: IHiveChainInterface,
	_tx: IOnlineTransaction
): Promise<HiveBroadcastOutcome> {
	return { broadcasted: false }
}

/**
 * Single authorized entry point for Hive broadcasts.
 * Simulation never calls chain.broadcast().
 */
export async function broadcastHiveTransaction(
	chain: IHiveChainInterface,
	tx: IOnlineTransaction
): Promise<HiveBroadcastOutcome> {
	if (isSimulationMode()) {
		return { broadcasted: false }
	}

	assertBroadcastAllowed()
	await chain.broadcast(tx)
	return { broadcasted: true }
}
