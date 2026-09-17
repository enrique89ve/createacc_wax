import {
  HIVE_TX_MODE_VALUES,
  type HiveExecutionMode,
} from '@/consts/hive-execution'

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

export function waxPipelinePassed(wax: HiveWaxPipelineStatus): boolean {
  return (
    wax.validated && wax.onChainVerified && wax.signed && wax.authorityVerified
  )
}

/**
 * Account-creation simulation: all four WAX checks, never broadcast.
 */
export function isSimulationSuccess(result: HiveTransactionResult): boolean {
  return (
    result.mode === HIVE_TX_MODE_VALUES.SIMULATE &&
    result.broadcasted === false &&
    waxPipelinePassed(result.wax)
  )
}

/**
 * RC simulation skips performOnChainVerification because the
 * delegatee does not exist on Hive yet.
 */
export function isRcSimulationSuccess(result: HiveTransactionResult): boolean {
  return (
    result.mode === HIVE_TX_MODE_VALUES.SIMULATE &&
    result.broadcasted === false &&
    result.wax.validated &&
    result.wax.signed &&
    result.wax.authorityVerified
  )
}
