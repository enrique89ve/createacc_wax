import type { HiveExecutionMode } from '@/consts/hive-execution'

export interface HiveWaxPipelineStatus {
	readonly validated: boolean
	readonly onChainVerified: boolean
	readonly signed: boolean
	readonly authorityVerified: boolean
}

export interface HiveTransactionResult {
	readonly id: string
	readonly mode: HiveExecutionMode
	readonly broadcasted: boolean
	readonly wax: HiveWaxPipelineStatus
	readonly requiredAuthorities: unknown
	readonly signaturePublicKeys: string[]
	readonly endpoint?: string
}

export function isSimulationSuccess(result: HiveTransactionResult): boolean {
	return (
		result.broadcasted === false &&
		result.wax.validated &&
		result.wax.signed &&
		result.wax.authorityVerified
	)
}

export function waxPipelinePassed(wax: HiveWaxPipelineStatus): boolean {
	return (
		wax.validated &&
		wax.onChainVerified &&
		wax.signed &&
		wax.authorityVerified
	)
}
