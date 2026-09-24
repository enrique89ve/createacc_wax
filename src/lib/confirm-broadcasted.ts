import { logger } from '@/lib/logger'
import { BLOCKCHAIN_STATUS } from '@/consts/hive-execution'
import { RECONCILIATION_CONFIG } from '@/consts/constants'
import { execute } from '@/lib/database'
import {
  getCreationAttempt,
  isAttemptStale,
  listOpenCreationAttempts,
  normalizeAttemptTicket,
  type CreationAttempt,
} from '@/lib/creation-attempts'
import { inspectHiveCreationEvidence } from '@/lib/creation-evidence'
import {
  persistHiveMatchedAccount,
  reconcileCreationAttempt,
} from '@/lib/creation-reconciler'

export { persistHiveMatchedAccount } from '@/lib/creation-reconciler'

export interface BroadcastedAccountRow {
  readonly username: string
  readonly correlationId: string | null
  readonly ticket: string
}

export async function listBroadcastedAccounts(): Promise<
  BroadcastedAccountRow[]
> {
  const result = await execute({
    sql: `SELECT username, correlation_id, ticket
			FROM Accounts
      WHERE blockchain_status = ?`,
    args: [BLOCKCHAIN_STATUS.BROADCASTED],
  })
  return result.rows.map(row => ({
    username: String(row.username),
    correlationId:
      typeof row.correlation_id === 'string' ? row.correlation_id : null,
    ticket: String(row.ticket),
  }))
}

export async function confirmBroadcastedAccount(
  account: BroadcastedAccountRow
): Promise<boolean> {
  if (!account.correlationId) {
    logger.warn(
      `[confirm-broadcasted] ${account.username} has no correlation_id; leaving ${account.username}`
    )
    return false
  }

  const attempt = await getCreationAttempt(account.correlationId)
  if (!attempt) {
    logger.warn(
      `[${account.correlationId}] No creation attempt for ${account.username}`
    )
    return false
  }
  if (
    attempt.username !== account.username ||
    attempt.ticket !== account.ticket
  ) {
    logger.warn(
      `[${account.correlationId}] Broadcasted account does not match its persisted creation attempt`
    )
    return false
  }

  const evidence = await inspectHiveCreationEvidence(attempt)
  if (evidence.kind !== 'created') {
    logger.warn(
      `[${account.correlationId}] ${account.username} creation evidence is ${evidence.kind}`
    )
    return false
  }

  return persistHiveMatchedAccount(attempt, evidence)
}

export async function confirmPendingBroadcastedAccounts(): Promise<number> {
  const pending = await listBroadcastedAccounts()
  let confirmed = 0
  for (const account of pending) {
    if (await confirmBroadcastedAccount(account)) confirmed += 1
  }
  return confirmed
}

async function recoverStaleAttempt(attempt: CreationAttempt): Promise<void> {
  const result = await reconcileCreationAttempt(attempt.correlationId)
  if (result.kind === 'rolled_back' || result.kind === 'completed') {
    logger.info(
      `[${attempt.correlationId}] Reconciled stale attempt as ${result.kind} for ${attempt.username}`
    )
  } else if (
    result.kind === 'pending' ||
    result.kind === 'review' ||
    result.kind === 'failed'
  ) {
    logger.warn(
      `[${attempt.correlationId}] Holding stale attempt for ${attempt.username}: ${result.reason}`
    )
  }
}

export async function recoverStaleCreationAttempts(): Promise<number> {
  const open = await listOpenCreationAttempts()
  let recovered = 0
  for (const attempt of open) {
    if (
      !isAttemptStale(attempt.updatedAt, RECONCILIATION_CONFIG.ATTEMPT_STALE_MS)
    ) {
      continue
    }
    await recoverStaleAttempt(attempt)
    recovered += 1
  }
  return recovered
}

export function sameAttemptIdentity(
  attempt: CreationAttempt,
  ticket: string,
  keys: CreationAttempt['keys']
): boolean {
  return (
    attempt.ticket === normalizeAttemptTicket(ticket) &&
    attempt.keys.ownerPublicKey === keys.ownerPublicKey &&
    attempt.keys.activePublicKey === keys.activePublicKey &&
    attempt.keys.postingPublicKey === keys.postingPublicKey &&
    attempt.keys.memoPublicKey === keys.memoPublicKey
  )
}
