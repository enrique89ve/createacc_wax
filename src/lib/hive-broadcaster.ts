import type { IHiveChainInterface, IOnlineTransaction } from '@hiveio/wax'
import { isBroadcastEnabled } from '@/lib/hive-execution-mode'

export interface HiveBroadcastOutcome {
	readonly broadcasted: boolean
}

export type HiveBroadcaster = (
	chain: IHiveChainInterface,
	tx: IOnlineTransaction
) => Promise<HiveBroadcastOutcome>

export class HiveBroadcastAttemptError extends Error {
	constructor(readonly cause: unknown) {
		const message = cause instanceof Error ? cause.message : 'Hive broadcast failed'
		super(message)
		this.name = 'HiveBroadcastAttemptError'
	}
}

export function unwrapBroadcastError(error: unknown): unknown {
	if (error instanceof HiveBroadcastAttemptError) return error.cause
	return error
}

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
 * No other file may call chain.broadcast().
 */
export async function broadcastHiveTransaction(
	chain: IHiveChainInterface,
	tx: IOnlineTransaction
): Promise<HiveBroadcastOutcome> {
	if (!isBroadcastEnabled()) {
		return { broadcasted: false }
	}
	try {
		await chain.broadcast(tx)
	} catch (error) {
		throw new HiveBroadcastAttemptError(error)
	}
	return { broadcasted: true }
}
