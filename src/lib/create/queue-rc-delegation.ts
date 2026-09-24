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
import {
  RC_DELEGATION_AMOUNT,
  RC_DELEGATION_CONFIG,
  RECONCILIATION_CONFIG,
} from '@/consts/constants'
import { execute } from '@/lib/database'
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

export interface RcDelegationLease {
  readonly username: string
  readonly token: string
  readonly generation: number
}

const RC_LEASE_DURATION_SECONDS = Math.max(
  1,
  Math.floor(RC_DELEGATION_CONFIG.PROCESSING_STALE_MS / 1000)
)

async function markRcDelegated(lease: RcDelegationLease): Promise<boolean> {
  const result = await execute({
    sql: `UPDATE Accounts
          SET rc_status = ?, rc_delegated = 1, rc_updated_at = CURRENT_TIMESTAMP,
              rc_lease_token = NULL, rc_lease_expires_at = NULL
          WHERE username = ? AND rc_status = ? AND rc_lease_token = ?
            AND rc_lease_generation = ? AND rc_lease_expires_at > CURRENT_TIMESTAMP
          RETURNING username`,
    args: [
      RC_STATUS.DELEGATED,
      lease.username,
      RC_STATUS.PROCESSING,
      lease.token,
      lease.generation,
    ],
  })
  return result.rows.length === 1
}

async function releaseRcProcessing(lease: RcDelegationLease): Promise<boolean> {
  const result = await execute({
    sql: `UPDATE Accounts
          SET rc_status = ?, rc_updated_at = CURRENT_TIMESTAMP,
              rc_lease_token = NULL, rc_lease_expires_at = NULL
          WHERE username = ? AND rc_status = ? AND rc_lease_token = ?
            AND rc_lease_generation = ? AND rc_lease_expires_at > CURRENT_TIMESTAMP
          RETURNING username`,
    args: [
      RC_STATUS.PENDING,
      lease.username,
      RC_STATUS.PROCESSING,
      lease.token,
      lease.generation,
    ],
  })
  return result.rows.length === 1
}

async function markRcUncertain(lease: RcDelegationLease): Promise<boolean> {
  const result = await execute({
    sql: `UPDATE Accounts
          SET rc_status = ?, rc_updated_at = CURRENT_TIMESTAMP,
              rc_lease_token = NULL, rc_lease_expires_at = NULL
          WHERE username = ? AND rc_status = ? AND rc_lease_token = ?
            AND rc_lease_generation = ? AND rc_lease_expires_at > CURRENT_TIMESTAMP
          RETURNING username`,
    args: [
      RC_STATUS.UNCERTAIN,
      lease.username,
      RC_STATUS.PROCESSING,
      lease.token,
      lease.generation,
    ],
  })
  return result.rows.length === 1
}

async function markObservedRcDelegated(username: string): Promise<boolean> {
  const result = await execute({
    sql: `UPDATE Accounts
          SET rc_status = ?, rc_delegated = 1, rc_updated_at = CURRENT_TIMESTAMP
          WHERE username = ? AND rc_status = ? AND rc_lease_token IS NULL
          RETURNING username`,
    args: [RC_STATUS.DELEGATED, username, RC_STATUS.UNCERTAIN],
  })
  return result.rows.length === 1
}

async function processClaimedRcDelegation(
  lease: RcDelegationLease,
  executionMode: HiveExecutionMode
): Promise<void> {
  try {
    const result = await delegateResourceCredits(
      {
        delegatee: lease.username,
        maxRc: RC_DELEGATION_AMOUNT,
      },
      executionMode
    )
    if (!(await markRcDelegated(lease))) {
      logger.warn(
        `[rc-delegation] Stale lease could not close completed Hive operation for ${lease.username}; reconciliation will inspect Hive.`
      )
      return
    }
    logger.info(
      `[rc-delegation] Delegated RC to ${lease.username} broadcast=${result.broadcasted} tx=${result.id}`
    )
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error'
    const analyzed = analyzeWaxError(unwrapBroadcastError(error))
    if (analyzed.code === AppErrorCode.RC_DELEGATION_EXISTS) {
      await confirmExistingRcDelegation(lease.username, lease)
      return
    }
    if (error instanceof HiveBroadcastAttemptError) {
      const marked = await markRcUncertain(lease)
      logger.warn(
        `[rc-delegation] Broadcast already attempted for ${lease.username}; uncertain=${marked}: ${errMsg}`
      )
      return
    }
    const released = await releaseRcProcessing(lease)
    logger.error(
      `[rc-delegation] Delegation for ${lease.username} remains ${released ? 'pending' : 'owned by a newer worker'}: ${errMsg}`
    )
  }
}

export async function queueRcDelegation(
  username: string,
  executionMode: HiveExecutionMode = getHiveExecutionMode(),
  lease?: RcDelegationLease
): Promise<void> {
  if (executionMode === HIVE_TX_MODE_VALUES.BROADCAST) {
    if (!lease || lease.username !== username) {
      logger.error(
        `[rc-delegation] Refusing broadcast without a matching database lease for ${username}`
      )
      return
    }
    await processClaimedRcDelegation(lease, executionMode)
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
  username: string,
  lease?: RcDelegationLease
): Promise<void> {
  const lookup = await fetchRcDelegationExists(username)
  if (lookup.status === 'found') {
    const marked = lease
      ? await markRcDelegated(lease)
      : await markObservedRcDelegated(username)
    logger.info(
      `[rc-delegation] Hive RC matches expected amount for ${username} (${lookup.delegatedRc.toString()}); persisted=${marked}`
    )
    return
  }
  if (lease) await markRcUncertain(lease)
  logger.warn(
    `[rc-delegation] RC is not confirmed at the expected amount for ${username}: ${lookup.status}`
  )
}

export async function applyUncertainRcLookup(
  username: string,
  lookup: RcDelegationLookup
): Promise<'delegated' | 'hold'> {
  if (lookup.status !== 'found') return 'hold'
  return (await markObservedRcDelegated(username)) ? 'delegated' : 'hold'
}

export async function claimAccountRcDelegation(
  username: string
): Promise<RcDelegationLease | null> {
  const token = crypto.randomUUID()
  const result = await execute({
    sql: `UPDATE Accounts
          SET rc_status = ?, rc_updated_at = CURRENT_TIMESTAMP,
              rc_lease_token = ?,
              rc_lease_expires_at = datetime('now', '+' || ? || ' seconds'),
              rc_lease_generation = rc_lease_generation + 1
          WHERE username = ? AND rc_status = ? AND blockchain_status = ?
          RETURNING username, rc_lease_generation`,
    args: [
      RC_STATUS.PROCESSING,
      token,
      RC_LEASE_DURATION_SECONDS,
      username,
      RC_STATUS.PENDING,
      BLOCKCHAIN_STATUS.CONFIRMED,
    ],
  })
  const row = result.rows[0]
  if (!row || typeof row.username !== 'string') return null
  const generation = Number(row.rc_lease_generation)
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new Error('Invalid claimed RC delegation lease')
  }
  return { username: row.username, token, generation }
}

export async function claimAndQueueConfirmedRc(
  username: string,
  executionMode: HiveExecutionMode = getHiveExecutionMode()
): Promise<boolean> {
  if (executionMode !== HIVE_TX_MODE_VALUES.BROADCAST) return false
  const lease = await claimAccountRcDelegation(username)
  if (!lease) return false
  await queueRcDelegation(username, executionMode, lease)
  return true
}

export async function recoverStaleRcProcessing(): Promise<number> {
  const result = await execute({
    sql: `UPDATE Accounts
          SET rc_status = ?, rc_updated_at = CURRENT_TIMESTAMP,
              rc_lease_token = NULL, rc_lease_expires_at = NULL
          WHERE rc_status = ? AND rc_lease_expires_at <= CURRENT_TIMESTAMP
          RETURNING username`,
    args: [RC_STATUS.UNCERTAIN, RC_STATUS.PROCESSING],
  })
  return result.rows.length
}

export async function processPendingRcDelegations(): Promise<number> {
  const executionMode = getHiveExecutionMode()
  if (executionMode !== HIVE_TX_MODE_VALUES.BROADCAST) return 0

  await recoverStaleRcProcessing()
  const pending = await execute({
    sql: `SELECT username FROM Accounts
          WHERE rc_status = ? AND blockchain_status = ?
          ORDER BY rc_updated_at ASC, id ASC
          LIMIT ?`,
    args: [
      RC_STATUS.PENDING,
      BLOCKCHAIN_STATUS.CONFIRMED,
      RECONCILIATION_CONFIG.BATCH_SIZE,
    ],
  })

  let processed = 0
  for (const row of pending.rows) {
    const username = String(row.username)
    const lease = await claimAccountRcDelegation(username)
    if (!lease) continue
    await queueRcDelegation(username, executionMode, lease)
    processed += 1
  }
  return processed
}

export async function listUncertainRcUsernames(): Promise<string[]> {
  const result = await execute({
    sql: `SELECT username FROM Accounts
          WHERE rc_status = ? AND blockchain_status = ?
          ORDER BY rc_updated_at ASC, id ASC
          LIMIT ?`,
    args: [
      RC_STATUS.UNCERTAIN,
      BLOCKCHAIN_STATUS.CONFIRMED,
      RECONCILIATION_CONFIG.BATCH_SIZE,
    ],
  })
  return result.rows.map(row => String(row.username))
}

export async function reconcileUncertainRcDelegations(): Promise<number> {
  await recoverStaleRcProcessing()
  const usernames = await listUncertainRcUsernames()
  let resolved = 0
  for (const username of usernames) {
    const lookup = await fetchRcDelegationExists(username)
    const outcome = await applyUncertainRcLookup(username, lookup)
    if (outcome === 'delegated') resolved += 1
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
