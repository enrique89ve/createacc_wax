import { CREATION_ATTEMPT_STATUS } from '@/consts/hive-execution'
import {
  claimCreationAttempt,
  getCreationAttempt,
  hiveTransactionFromRecoveredAttempt,
  releaseCreationAttemptLease,
  type CreationAttempt,
  type CreationAttemptLease,
} from '@/lib/creation-attempts'
import {
  inspectHiveCreationEvidence,
  type HiveCreationEvidenceProvider,
  type HiveCreationEvidence,
} from '@/lib/creation-evidence'
import { claimAndQueueConfirmedRc } from '@/lib/create/queue-rc-delegation'
import {
  confirmCompletedAttemptAccount,
  completeAccountCreationInDB,
  rollbackTicketReservation,
} from '@/utils/db-ticket-validator'

export type CreationReconciliationResult =
  | { readonly kind: 'completed'; readonly correlationId: string }
  | { readonly kind: 'rolled_back'; readonly correlationId: string }
  | { readonly kind: 'would_complete'; readonly correlationId: string }
  | { readonly kind: 'would_rollback'; readonly correlationId: string }
  | {
      readonly kind: 'already_terminal'
      readonly correlationId: string
      readonly status: 'completed' | 'rolled_back'
    }
  | { readonly kind: 'busy'; readonly correlationId: string }
  | { readonly kind: 'not_found'; readonly correlationId: string }
  | {
      readonly kind: 'pending' | 'review' | 'failed'
      readonly correlationId: string
      readonly reason: string
    }

function evidenceDescription(evidence: HiveCreationEvidence): string {
  if (evidence.kind === 'pending') {
    return `Hive transaction is ${evidence.status}`
  }
  if (evidence.kind === 'review' || evidence.kind === 'unavailable') {
    return evidence.reason
  }
  return evidence.kind
}

function sameAttemptSnapshot(
  current: CreationAttempt,
  expected: CreationAttempt
): boolean {
  return (
    current.correlationId === expected.correlationId &&
    current.username === expected.username &&
    current.ticket === expected.ticket &&
    current.ticketId === expected.ticketId &&
    current.fundingSource === expected.fundingSource &&
    current.ownerBuilderUsername === expected.ownerBuilderUsername &&
    current.transactionId === expected.transactionId &&
    current.transactionExpiresAt === expected.transactionExpiresAt &&
    current.keys.ownerPublicKey === expected.keys.ownerPublicKey &&
    current.keys.activePublicKey === expected.keys.activePublicKey &&
    current.keys.postingPublicKey === expected.keys.postingPublicKey &&
    current.keys.memoPublicKey === expected.keys.memoPublicKey
  )
}

export async function persistHiveMatchedAccount(
  expectedAttempt: CreationAttempt,
  evidence: HiveCreationEvidence,
  providedLease?: CreationAttemptLease
): Promise<boolean> {
  if (
    evidence.kind !== 'created' ||
    evidence.transactionId.toLowerCase() !==
      expectedAttempt.transactionId?.toLowerCase()
  ) {
    return false
  }

  let lease = providedLease
  let current = await getCreationAttempt(expectedAttempt.correlationId)
  if (!current || current.status === CREATION_ATTEMPT_STATUS.ROLLED_BACK) {
    return false
  }
  if (current.status !== CREATION_ATTEMPT_STATUS.COMPLETED && !lease) {
    lease =
      (await claimCreationAttempt(expectedAttempt.correlationId)) ?? undefined
    if (!lease) return false
    current = await getCreationAttempt(expectedAttempt.correlationId)
  }
  if (!current || !sameAttemptSnapshot(current, expectedAttempt)) return false

  const completed = await completeAccountCreationInDB(
    current.correlationId,
    hiveTransactionFromRecoveredAttempt(current) ?? undefined,
    { hiveMatched: true },
    lease
  )
  if (!completed.success) return false
  if (!(await confirmCompletedAttemptAccount(current.correlationId))) {
    return false
  }
  await claimAndQueueConfirmedRc(current.username)
  return true
}

export async function reconcileCreationAttempt(
  correlationId: string,
  options: {
    readonly dryRun?: boolean
    readonly lease?: CreationAttemptLease
    readonly evidenceProvider?: HiveCreationEvidenceProvider
  } = {}
): Promise<CreationReconciliationResult> {
  const attempt = await getCreationAttempt(correlationId)
  if (!attempt) return { kind: 'not_found', correlationId }
  if (
    attempt.status === CREATION_ATTEMPT_STATUS.COMPLETED ||
    attempt.status === CREATION_ATTEMPT_STATUS.ROLLED_BACK
  ) {
    return {
      kind: 'already_terminal',
      correlationId,
      status: attempt.status,
    }
  }

  if (options.dryRun === true) {
    if (
      attempt.status === CREATION_ATTEMPT_STATUS.RESERVED ||
      attempt.status === CREATION_ATTEMPT_STATUS.PREPARED
    ) {
      return { kind: 'would_rollback', correlationId }
    }
    const evidence = await inspectHiveCreationEvidence(
      attempt,
      options.evidenceProvider
    )
    if (evidence.kind === 'created') {
      return { kind: 'would_complete', correlationId }
    }
    if (evidence.kind === 'not_executed') {
      return { kind: 'would_rollback', correlationId }
    }
    return {
      kind: evidence.kind === 'pending' ? 'pending' : 'review',
      correlationId,
      reason: evidenceDescription(evidence),
    }
  }

  const providedLease = options.lease
  if (providedLease && providedLease.correlationId !== correlationId) {
    return {
      kind: 'review',
      correlationId,
      reason: 'Lease belongs to a different creation attempt',
    }
  }
  const lease = providedLease ?? (await claimCreationAttempt(correlationId))
  if (!lease) return { kind: 'busy', correlationId }

  try {
    const current = await getCreationAttempt(correlationId)
    if (!current || !sameAttemptSnapshot(current, attempt)) {
      await releaseCreationAttemptLease(lease)
      return {
        kind: 'review',
        correlationId,
        reason: 'Attempt identity changed while ownership was claimed',
      }
    }

    if (
      current.status === CREATION_ATTEMPT_STATUS.RESERVED ||
      current.status === CREATION_ATTEMPT_STATUS.PREPARED
    ) {
      const rollback = await rollbackTicketReservation(correlationId, lease)
      return rollback.success
        ? { kind: 'rolled_back', correlationId }
        : {
            kind: 'failed',
            correlationId,
            reason: rollback.error ?? 'Ticket rollback failed',
          }
    }

    const evidence = await inspectHiveCreationEvidence(
      current,
      options.evidenceProvider
    )
    if (evidence.kind === 'created') {
      const completed = await persistHiveMatchedAccount(
        current,
        evidence,
        lease
      )
      if (completed) return { kind: 'completed', correlationId }
      await releaseCreationAttemptLease(lease)
      return {
        kind: 'failed',
        correlationId,
        reason: 'Hive creation evidence could not be committed locally',
      }
    }
    if (evidence.kind === 'not_executed') {
      const rollback = await rollbackTicketReservation(correlationId, lease)
      return rollback.success
        ? { kind: 'rolled_back', correlationId }
        : {
            kind: 'failed',
            correlationId,
            reason: rollback.error ?? 'Ticket rollback failed',
          }
    }

    await releaseCreationAttemptLease(lease)
    return {
      kind: evidence.kind === 'pending' ? 'pending' : 'review',
      correlationId,
      reason: evidenceDescription(evidence),
    }
  } catch (error) {
    await releaseCreationAttemptLease(lease)
    return {
      kind: 'failed',
      correlationId,
      reason: error instanceof Error ? error.message : 'Reconciliation failed',
    }
  }
}
