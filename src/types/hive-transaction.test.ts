import { describe, expect, it } from 'vitest'
import { HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'
import {
  isRcSimulationSuccess,
  isSimulationSuccess,
  type HiveTransactionResult,
} from '@/types/hive-transaction'

function baseResult(
  wax: Partial<HiveTransactionResult['wax']> = {}
): HiveTransactionResult {
  return {
    id: 'txid',
    mode: HIVE_TX_MODE_VALUES.SIMULATE,
    broadcasted: false,
    wax: {
      validated: true,
      onChainVerified: true,
      signed: true,
      authorityVerified: true,
      ...wax,
    },
    requiredAuthorities: {},
    signaturePublicKeys: ['STM7public'],
  }
}

describe('simulation success predicates', () => {
  it('account simulation requires on-chain verification', () => {
    expect(isSimulationSuccess(baseResult())).toBe(true)
    expect(isSimulationSuccess(baseResult({ onChainVerified: false }))).toBe(
      false
    )
  })

  it('account simulation fails if any WAX check is missing', () => {
    expect(isSimulationSuccess(baseResult({ validated: false }))).toBe(false)
    expect(isSimulationSuccess(baseResult({ signed: false }))).toBe(false)
    expect(isSimulationSuccess(baseResult({ authorityVerified: false }))).toBe(
      false
    )
  })

  it('account simulation fails if broadcasted', () => {
    expect(isSimulationSuccess({ ...baseResult(), broadcasted: true })).toBe(
      false
    )
  })

  it('RC simulation allows skipped on-chain verification', () => {
    expect(isRcSimulationSuccess(baseResult({ onChainVerified: false }))).toBe(
      true
    )
    expect(isRcSimulationSuccess(baseResult({ signed: false }))).toBe(false)
    expect(isRcSimulationSuccess({ ...baseResult(), broadcasted: true })).toBe(
      false
    )
  })
})
