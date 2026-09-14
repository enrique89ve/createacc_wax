import {
	BLOCKCHAIN_STATUS,
	HIVE_TX_MODE_VALUES,
	WAX_STATUS,
	type BlockchainStatus,
	type HiveExecutionMode,
} from '@/consts/hive-execution'

export type AccountStatusLabel = 'SIMULATED' | 'BROADCASTED' | 'CONFIRMED' | 'FAILED'

export interface PersistedAccountCreation {
	readonly username: string
	readonly executionMode: HiveExecutionMode
	readonly blockchainStatus: BlockchainStatus
	readonly transactionId: string | null
	readonly waxStatus: string | null
}

export function toAccountStatusLabel(status: string | null | undefined): AccountStatusLabel {
	if (status === BLOCKCHAIN_STATUS.SIMULATED) return 'SIMULATED'
	if (status === BLOCKCHAIN_STATUS.BROADCASTED) return 'BROADCASTED'
	if (status === BLOCKCHAIN_STATUS.CONFIRMED) return 'CONFIRMED'
	return 'FAILED'
}

export function isSimulatedAccount(status: string | null | undefined): boolean {
	return status === BLOCKCHAIN_STATUS.SIMULATED
}

export function parseExecutionMode(value: unknown): HiveExecutionMode {
	return value === HIVE_TX_MODE_VALUES.BROADCAST
		? HIVE_TX_MODE_VALUES.BROADCAST
		: HIVE_TX_MODE_VALUES.SIMULATE
}

export function parseBlockchainStatus(value: unknown): BlockchainStatus {
	if (value === BLOCKCHAIN_STATUS.SIMULATED) return BLOCKCHAIN_STATUS.SIMULATED
	if (value === BLOCKCHAIN_STATUS.BROADCASTED) return BLOCKCHAIN_STATUS.BROADCASTED
	if (value === BLOCKCHAIN_STATUS.CONFIRMED) return BLOCKCHAIN_STATUS.CONFIRMED
	return BLOCKCHAIN_STATUS.FAILED
}

export function creationFlagsFromPersistedAccount(account: PersistedAccountCreation) {
	const waxPassed = account.waxStatus === WAX_STATUS.PASSED
	const confirmed = account.blockchainStatus === BLOCKCHAIN_STATUS.CONFIRMED
	const broadcasted =
		account.blockchainStatus === BLOCKCHAIN_STATUS.BROADCASTED || confirmed
	return {
		executionMode: account.executionMode,
		waxValidated: waxPassed,
		onChainVerified: waxPassed,
		signed: waxPassed,
		authorityVerified: waxPassed,
		broadcasted,
		chainConfirmed: confirmed,
	}
}
