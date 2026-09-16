export const HIVE_TX_MODE_VALUES = {
	SIMULATE: 'simulate',
	BROADCAST: 'broadcast',
} as const

export type HiveExecutionMode =
	(typeof HIVE_TX_MODE_VALUES)[keyof typeof HIVE_TX_MODE_VALUES]

export const HIVE_BROADCAST_CONFIRM_VALUE = 'HIVE_MAINNET' as const

export const BLOCKCHAIN_STATUS = {
	SIMULATED: 'simulated',
	BROADCASTED: 'broadcasted',
	CONFIRMED: 'confirmed',
	FAILED: 'failed',
} as const

export type BlockchainStatus =
	(typeof BLOCKCHAIN_STATUS)[keyof typeof BLOCKCHAIN_STATUS]

export const WAX_STATUS = {
	PASSED: 'passed',
	FAILED: 'failed',
} as const

export type WaxStatus = (typeof WAX_STATUS)[keyof typeof WAX_STATUS]

export const CREATION_ATTEMPT_STATUS = {
	RESERVED: 'reserved',
	PREPARED: 'prepared',
	COMPLETED: 'completed',
	ROLLED_BACK: 'rolled_back',
} as const

export type CreationAttemptStatus =
	(typeof CREATION_ATTEMPT_STATUS)[keyof typeof CREATION_ATTEMPT_STATUS]

export const RC_PREFLIGHT_THRESHOLDS = {
	PASS_PERCENT: 20,
	WARNING_PERCENT: 5,
} as const

export const PREFLIGHT_CHECK_STATUS = {
	PASS: 'pass',
	WARNING: 'warning',
	FAIL: 'fail',
} as const

export type PreflightCheckStatus =
	(typeof PREFLIGHT_CHECK_STATUS)[keyof typeof PREFLIGHT_CHECK_STATUS]
