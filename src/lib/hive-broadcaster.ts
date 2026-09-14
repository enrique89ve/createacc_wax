import type { IHiveChainInterface, IOnlineTransaction } from '@hiveio/wax'
import {
	assertBroadcastAllowed,
	isSimulationMode,
} from '@/lib/hive-execution-mode'

export interface HiveBroadcastOutcome {
	readonly broadcasted: boolean
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
