import { logger } from '@/lib/logger'
import {
  delegateResourceCredits,
  simulateRcDelegation,
} from '@/lib/create/delegate-rc'
import {
  canDelegateResourceCredits,
  getHiveExecutionMode,
} from '@/lib/hive-execution-mode'
import {
  HiveBroadcastAttemptError,
  unwrapBroadcastError,
} from '@/lib/hive-broadcaster'
import { RC_DELEGATION_AMOUNT, RC_DELEGATION_CONFIG } from '@/consts/constants'
import { db } from '@/lib/database'
import {
  BLOCKCHAIN_STATUS,
  HIVE_TX_MODE_VALUES,
  RC_STATUS,
  type HiveExecutionMode,
} from '@/consts/hive-execution'
import { analyzeWaxError } from '@/lib/wax-error-utils'
import { AppErrorCode } from '@/consts/errors'
import {
  fetchRcDelegationExists,
  type RcDelegationLookup,
} from '@/lib/hive-rc-lookup'

async function markRcDelegated(username: string): Promise<void> {
  await db.execute({
    sql: `UPDATE Accounts
			SET rc_status = ?, rc_delegated = 1, rc_updated_at = CURRENT_TIMESTAMP
			WHERE username = ? AND rc_status IN (?, ?)`,
    args: [
      RC_STATUS.DELEGATED,
      username,
      RC_STATUS.PROCESSING,
      RC_STATUS.UNCERTAIN,
    ],
  })
}

async function releaseRcProcessing(username: string): Promise<void> {
  await db.execute({
    sql: `UPDATE Accounts
			SET rc_status = ?, rc_updated_at = CURRENT_TIMESTAMP
			WHERE username = ? AND rc_status = ?`,
    args: [RC_STATUS.PENDING, username, RC_STATUS.PROCESSING],
  })
}

async function markRcUncertain(username: string): Promise<void> {
  await db.execute({
    sql: `UPDATE Accounts
			SET rc_status = ?, rc_updated_at = CURRENT_TIMESTAMP
			WHERE username = ? AND rc_status = ?`,
    args: [RC_STATUS.UNCERTAIN, username, RC_STATUS.PROCESSING],
  })
}

async function processClaimedRcDelegation(
  username: string,
  executionMode: HiveExecutionMode
): Promise<void> {
  try {
    const result = await delegateResourceCredits(
      {
        delegatee: username,
        maxRc: RC_DELEGATION_AMOUNT,
      },
      executionMode
    )
    await markRcDelegated(username)
    logger.info(
      `[rc-delegation] Delegated RC to ${username} broadcast=${result.broadcasted} tx=${result.id}`
    )
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    const analyzed = analyzeWaxError(unwrapBroadcastError(error))
    if (analyzed.code === AppErrorCode.RC_DELEGATION_EXISTS) {
      await confirmExistingRcDelegation(username)
      return
    }
    if (error instanceof HiveBroadcastAttemptError) {
      await markRcUncertain(username)
      logger.warn(
        `[rc-delegation] Broadcast already attempted for ${username}: ${errMsg}. Marked uncertain.`
      )
      return
    }
    await releaseRcProcessing(username)
    logger.error(
      `[rc-delegation] Delegation for ${username} remains pending: ${errMsg}`
    )
  }
}

export async function queueRcDelegation(
  username: string,
  executionMode: HiveExecutionMode = getHiveExecutionMode()
): Promise<void> {
  if (executionMode === HIVE_TX_MODE_VALUES.BROADCAST) {
    await processClaimedRcDelegation(username, executionMode)
    return
  }
  try {
    await simulateRcDelegation(username, RC_DELEGATION_AMOUNT)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.warn(
      `[rc-delegation] Unexpected simulation error for ${username}: ${errMsg}`
    )
  }
}

export async function confirmExistingRcDelegation(
  username: string
): Promise<void> {
  const lookup = await fetchRcDelegationExists(username)
  if (lookup.status === 'found') {
    await markRcDelegated(username)
    logger.info(
      `[rc-delegation] Hive RC matches expected amount for ${username} (${lookup.delegatedRc.toString()})`
    )
    return
  }
  await markRcUncertain(username)
  logger.warn(
    `[rc-delegation] RC exists on Hive but is not the expected amount for ${username}: ${lookup.status}`
  )
}

export async function applyUncertainRcLookup(
  username: string,
  lookup: RcDelegationLookup
): Promise<'delegated' | 'retry' | 'hold'> {
  if (lookup.status === 'found') {
    await markRcDelegated(username)
    return 'delegated'
  }
  if (lookup.status === 'not_found') {
    await db.execute({
      sql: `UPDATE Accounts
            SET rc_status = ?, rc_updated_at = CURRENT_TIMESTAMP
            WHERE username = ? AND rc_status = ?`,
      args: [RC_STATUS.PENDING, username, RC_STATUS.UNCERTAIN],
    })
    return 'retry'
  }
  return 'hold'
}

export async function claimAccountRcDelegation(
  username: string
): Promise<boolean> {
  const result = await db.execute({
    sql: `UPDATE Accounts
			SET rc_status = ?, rc_updated_at = CURRENT_TIMESTAMP
			WHERE username = ?
			  AND rc_status = ?
			  AND blockchain_status = ?
			RETURNING username`,
    args: [
      RC_STATUS.PROCESSING,
      username,
      RC_STATUS.PENDING,
      BLOCKCHAIN_STATUS.CONFIRMED,
    ],
  })
  return result.rows.length > 0
}

export async function claimAndQueueConfirmedRc(
  username: string,
  executionMode: HiveExecutionMode = getHiveExecutionMode()
): Promise<boolean> {
  if (executionMode !== HIVE_TX_MODE_VALUES.BROADCAST) return false
  const claimed = await claimAccountRcDelegation(username)
  if (!claimed) return false
  await queueRcDelegation(username, executionMode)
  return true
}

export async function recoverStaleRcProcessing(): Promise<number> {
  const staleSeconds = Math.max(
    1,
    Math.floor(RC_DELEGATION_CONFIG.PROCESSING_STALE_MS / 1000)
  )
  const result = await db.execute({
    sql: `UPDATE Accounts
          SET rc_status = ?, rc_updated_at = CURRENT_TIMESTAMP
          WHERE rc_status = ?
            AND rc_updated_at <= datetime('now', '-' || ? || ' seconds')
          RETURNING username`,
    args: [RC_STATUS.PENDING, RC_STATUS.PROCESSING, staleSeconds],
  })
  return result.rows.length
}

export async function processPendingRcDelegations(): Promise<number> {
  const executionMode = getHiveExecutionMode()
  if (executionMode !== HIVE_TX_MODE_VALUES.BROADCAST) return 0

  const recovered = await recoverStaleRcProcessing()
  const pending = await db.execute({
    sql: `SELECT username FROM Accounts
          WHERE rc_status = ? AND blockchain_status = ?
          ORDER BY rc_updated_at ASC`,
    args: [RC_STATUS.PENDING, BLOCKCHAIN_STATUS.CONFIRMED],
  })

  let processed = recovered
  for (const row of pending.rows) {
    const username = String(row.username)
    const claimed = await claimAccountRcDelegation(username)
    if (!claimed) continue
    await queueRcDelegation(username, executionMode)
    processed += 1
  }
  return processed
}

export async function listUncertainRcUsernames(): Promise<string[]> {
  const result = await db.execute({
    sql: `SELECT username FROM Accounts
			WHERE rc_status = ? AND blockchain_status = ?`,
    args: [RC_STATUS.UNCERTAIN, BLOCKCHAIN_STATUS.CONFIRMED],
  })
  return result.rows.map(row => String(row.username))
}

export async function reconcileUncertainRcDelegations(): Promise<number> {
  const executionMode = getHiveExecutionMode()
  const usernames = await listUncertainRcUsernames()
  let resolved = 0
  for (const username of usernames) {
    const lookup = await fetchRcDelegationExists(username)
    const outcome = await applyUncertainRcLookup(username, lookup)
    if (outcome === 'hold') continue
    if (
      outcome === 'retry' &&
      executionMode === HIVE_TX_MODE_VALUES.BROADCAST
    ) {
      await claimAndQueueConfirmedRc(username, executionMode)
    }
    resolved += 1
  }
  return resolved
}

export function maybeQueueRcDelegation(
  username: string,
  chainConfirmed: boolean
): void {
  const executionMode = getHiveExecutionMode()
  if (!canDelegateResourceCredits(chainConfirmed, executionMode)) return
  if (executionMode === HIVE_TX_MODE_VALUES.BROADCAST) {
    claimAndQueueConfirmedRc(username, executionMode).catch(error => {
      const errMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.warn(
        `[rc-delegation] Failed to claim RC for ${username}: ${errMsg}`
      )
    })
    return
  }
  queueRcDelegation(username, executionMode).catch(error => {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.warn(
      `[rc-delegation] Failed to simulate RC for ${username}: ${errMsg}`
    )
  })
}
