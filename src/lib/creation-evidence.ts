import type { TWaxExtended } from '@hiveio/wax'
import { hiveChain } from '@/lib/hiveservice'
import { authoritiesFromHiveAccount } from '@/lib/hive-account-authorities'
import type { CreationAttempt } from '@/lib/creation-attempts'

export type HiveCreationTransactionStatus =
  | 'unknown'
  | 'within_mempool'
  | 'within_reversible_block'
  | 'within_irreversible_block'
  | 'expired_reversible'
  | 'expired_irreversible'
  | 'too_old'

export type HiveCreationEvidence =
  | {
      readonly kind: 'created'
      readonly transactionId: string
      readonly operationIndex: number
    }
  | {
      readonly kind: 'not_executed'
      readonly transactionId: string
      readonly status: 'expired_irreversible'
    }
  | { readonly kind: 'pending'; readonly status: HiveCreationTransactionStatus }
  | { readonly kind: 'review'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string }

export type HiveCreationEvidenceProvider = {
  readonly getStatus: (input: {
    readonly transactionId: string
    readonly expiration: string
  }) => Promise<unknown>
  readonly getTransaction: (transactionId: string) => Promise<unknown>
}

type HiveCreationApi = {
  transaction_status_api: {
    find_transaction: {
      params: {
        readonly transaction_id: string
        readonly expiration: string
      }
      result: unknown
    }
  }
  account_history_api: {
    get_transaction: {
      params: {
        readonly id: string
        readonly include_reversible: boolean
      }
      result: unknown
    }
  }
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  'unknown',
  'within_mempool',
  'within_reversible_block',
  'within_irreversible_block',
  'expired_reversible',
  'expired_irreversible',
  'too_old',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function statusFromUnknown(
  value: unknown
): HiveCreationTransactionStatus | null {
  if (!isRecord(value) || typeof value.status !== 'string') return null
  if (!KNOWN_STATUSES.has(value.status)) return null
  return value.status as HiveCreationTransactionStatus
}

function utcTimestamp(value: string): number | null {
  const normalized = value.endsWith('Z') ? value : `${value}Z`
  const timestamp = Date.parse(normalized)
  return Number.isFinite(timestamp) ? timestamp : null
}

function transactionMatchesAttempt(
  value: unknown,
  attempt: CreationAttempt
): number | null {
  if (!isRecord(value)) return null
  const transactionId = value.transaction_id
  const operations = value.operations
  if (
    typeof transactionId !== 'string' ||
    transactionId.toLowerCase() !== attempt.transactionId?.toLowerCase() ||
    !Array.isArray(operations)
  ) {
    return null
  }

  const matches: number[] = []
  for (const [index, operation] of operations.entries()) {
    if (
      !isRecord(operation) ||
      operation.type !== 'create_claimed_account_operation' ||
      !isRecord(operation.value)
    ) {
      continue
    }
    const payload = operation.value
    if (payload.new_account_name !== attempt.username) continue
    const authorities = authoritiesFromHiveAccount({
      owner: payload.owner,
      active: payload.active,
      posting: payload.posting,
      memo_key: payload.memo_key,
    })
    if (
      authorities?.ownerKey === attempt.keys.ownerPublicKey &&
      authorities.activeKey === attempt.keys.activePublicKey &&
      authorities.postingKey === attempt.keys.postingPublicKey &&
      authorities.memoKey === attempt.keys.memoPublicKey
    ) {
      matches.push(index)
    }
  }
  return matches.length === 1 ? (matches[0] ?? null) : null
}

export function evaluateHiveCreationEvidence(params: {
  readonly attempt: CreationAttempt
  readonly statusResult: unknown
  readonly transactionResult?: unknown
  readonly now?: number
}): HiveCreationEvidence {
  const { attempt } = params
  const status = statusFromUnknown(params.statusResult)
  if (!status) {
    return {
      kind: 'unavailable',
      reason: 'Hive returned an unknown transaction status',
    }
  }

  if (
    !attempt.transactionId ||
    !attempt.transactionExpiresAt ||
    !Number.isFinite(Date.parse(attempt.transactionExpiresAt))
  ) {
    return {
      kind: 'review',
      reason: 'Attempt lacks a valid transaction identity and expiration',
    }
  }

  if (status === 'within_irreversible_block') {
    const operationIndex = transactionMatchesAttempt(
      params.transactionResult,
      attempt
    )
    return operationIndex === null
      ? {
          kind: 'review',
          reason:
            'Irreversible transaction does not prove this account creation operation',
        }
      : {
          kind: 'created',
          transactionId: attempt.transactionId,
          operationIndex,
        }
  }

  if (status === 'expired_irreversible') {
    const expiresAt = utcTimestamp(attempt.transactionExpiresAt)
    const now = params.now ?? Date.now()
    return expiresAt !== null && now >= expiresAt
      ? {
          kind: 'not_executed',
          transactionId: attempt.transactionId,
          status,
        }
      : {
          kind: 'review',
          reason:
            'Hive reported expiration before the persisted expiration time',
        }
  }

  if (
    status === 'unknown' ||
    status === 'within_mempool' ||
    status === 'within_reversible_block' ||
    status === 'expired_reversible'
  ) {
    return { kind: 'pending', status }
  }

  return {
    kind: 'review',
    reason: 'Hive no longer has enough transaction history to decide safely',
  }
}

const defaultProvider: HiveCreationEvidenceProvider = {
  async getStatus(input) {
    const chain = await hiveChain()
    const extended: TWaxExtended<HiveCreationApi> =
      chain.extend<HiveCreationApi>()
    return extended.api.transaction_status_api.find_transaction({
      transaction_id: input.transactionId,
      expiration: input.expiration,
    })
  },
  async getTransaction(transactionId) {
    const chain = await hiveChain()
    const extended: TWaxExtended<HiveCreationApi> =
      chain.extend<HiveCreationApi>()
    return extended.api.account_history_api.get_transaction({
      id: transactionId,
      include_reversible: false,
    })
  },
}

export async function inspectHiveCreationEvidence(
  attempt: CreationAttempt,
  provider: HiveCreationEvidenceProvider = defaultProvider,
  now: number = Date.now()
): Promise<HiveCreationEvidence> {
  if (!attempt.transactionId || !attempt.transactionExpiresAt) {
    return {
      kind: 'review',
      reason: 'Attempt lacks a persisted transaction identity and expiration',
    }
  }
  try {
    const statusResult = await provider.getStatus({
      transactionId: attempt.transactionId,
      expiration: attempt.transactionExpiresAt,
    })
    const status = statusFromUnknown(statusResult)
    const transactionResult =
      status === 'within_irreversible_block'
        ? await provider.getTransaction(attempt.transactionId)
        : undefined
    return evaluateHiveCreationEvidence({
      attempt,
      statusResult,
      transactionResult,
      now,
    })
  } catch (error) {
    return {
      kind: 'unavailable',
      reason:
        error instanceof Error ? error.message : 'Hive evidence lookup failed',
    }
  }
}
