import {
  HIVE_TX_MODE_VALUES,
  type HiveExecutionMode,
} from '@/consts/hive-execution'
import { ENV_KEYS } from '@/consts/constants'

function readProcessEnv(name: string): string {
  const value = process.env[name]
  if (typeof value !== 'string') return ''
  return value.trim()
}

/**
 * Sole execution switch. Missing/unknown values are simulate.
 * Broadcast means live mainnet transmission. Nothing else.
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

export function isBroadcastEnabled(): boolean {
  return getHiveExecutionMode() === HIVE_TX_MODE_VALUES.BROADCAST
}

export function canDelegateResourceCredits(
  chainConfirmed: boolean,
  executionMode: HiveExecutionMode = getHiveExecutionMode()
): boolean {
  if (executionMode === HIVE_TX_MODE_VALUES.SIMULATE) return true
  return chainConfirmed
}
