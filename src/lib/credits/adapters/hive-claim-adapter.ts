import { type TWaxExtended, type TWaxRestExtended } from '@hiveio/wax'
import { BRAND } from '@/consts/branding'
import { hiveChain } from '@/lib/hiveservice'

const CLAIM_OPERATION_ID = 'claim_credits'
const MAX_TRANSACTION_AGE_MS = 30 * 60 * 1000
const FUTURE_CLOCK_SKEW_MS = 30 * 1000

export type HiveClaimVerificationInput = {
  readonly transactionId: string
  readonly hash: string
  readonly username: string
}

export type VerifiedHiveClaim = {
  readonly username: string
  readonly hash: string
  readonly transactionId: string
  readonly operationIndex: number
  readonly externalReference: string
}

export type HiveClaimAdapterResult =
  | { readonly ok: true; readonly claim: VerifiedHiveClaim }
  | {
      readonly ok: false
      readonly kind: 'pending' | 'invalid' | 'unavailable'
      readonly error: string
    }

export type HiveTransactionStatus =
  | 'unknown'
  | 'within_mempool'
  | 'within_reversible_block'
  | 'within_irreversible_block'
  | 'expired_reversible'
  | 'expired_irreversible'
  | 'too_old'

export type HiveClaimProvider = {
  readonly getStatus: (transactionId: string) => Promise<unknown>
  readonly getTransaction: (transactionId: string) => Promise<unknown>
}

type HiveOperation = {
  readonly type: string
  readonly value: {
    readonly id?: string
    readonly json?: string
    readonly requiredPostingAuths: readonly string[]
  }
}

type HiveTransaction = {
  readonly transactionId: string
  readonly timestamp: string
  readonly operations: readonly HiveOperation[]
}

type HiveStatusApi = {
  transaction_status_api: {
    find_transaction: {
      params: {
        readonly transaction_id: string
        readonly expiration?: string
      }
      result: unknown
    }
  }
}

const HIVE_TRANSACTION_STATUSES: ReadonlySet<string> = new Set([
  'unknown',
  'within_mempool',
  'within_reversible_block',
  'within_irreversible_block',
  'expired_reversible',
  'expired_irreversible',
  'too_old',
])

type ClaimJson = {
  readonly app: string
  readonly hash: string
  readonly username: string
  readonly timestamp: number
  readonly action: string
}

type HafahApi = {
  'hafah-api': {
    transactions: {
      byId: {
        params: { readonly transactionId: string }
        result: unknown
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeTransactionId(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return /^[a-f0-9]{8,128}$/.test(normalized) ? normalized : null
}

function parseStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every(item => typeof item === 'string')) return null
  return value
}

function parseTransaction(value: unknown): HiveTransaction | null {
  if (!isRecord(value)) return null

  const transactionId = value.transaction_id
  const timestamp = value.timestamp
  const transactionJson = value.transaction_json
  if (
    typeof transactionId !== 'string' ||
    typeof timestamp !== 'string' ||
    !isRecord(transactionJson) ||
    !Array.isArray(transactionJson.operations)
  ) {
    return null
  }

  const operations: HiveOperation[] = []
  for (const operation of transactionJson.operations) {
    if (!isRecord(operation) || typeof operation.type !== 'string') return null
    if (!isRecord(operation.value)) return null

    if (operation.type !== 'custom_json_operation') {
      operations.push({
        type: operation.type,
        value: { requiredPostingAuths: [] },
      })
      continue
    }

    const id = operation.value.id
    const json = operation.value.json
    const requiredPostingAuths = parseStringArray(
      operation.value.required_posting_auths
    )
    if (
      typeof id !== 'string' ||
      typeof json !== 'string' ||
      requiredPostingAuths === null
    ) {
      return null
    }

    operations.push({
      type: operation.type,
      value: { id, json, requiredPostingAuths },
    })
  }

  return { transactionId, timestamp, operations }
}

function parseClaimJson(value: unknown): ClaimJson | null {
  if (!isRecord(value)) return null

  const app = value.app
  const hash = value.hash
  const username = value.username
  const timestamp = value.timestamp
  const action = value.action
  if (
    typeof app !== 'string' ||
    typeof hash !== 'string' ||
    typeof username !== 'string' ||
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp) ||
    typeof action !== 'string'
  ) {
    return null
  }

  return { app, hash, username, timestamp, action }
}

function invalid(error: string): HiveClaimAdapterResult {
  return { ok: false, kind: 'invalid', error }
}

function pending(error: string): HiveClaimAdapterResult {
  return { ok: false, kind: 'pending', error }
}

function unavailable(error: string): HiveClaimAdapterResult {
  return { ok: false, kind: 'unavailable', error }
}

function parseTransactionStatus(value: unknown): HiveTransactionStatus | null {
  if (!isRecord(value) || typeof value.status !== 'string') return null
  if (!HIVE_TRANSACTION_STATUSES.has(value.status)) return null
  return value.status as HiveTransactionStatus
}

function verifyTransactionPayload(
  rawTransaction: unknown,
  input: HiveClaimVerificationInput,
  now: number
): HiveClaimAdapterResult {
  const transactionId = normalizeTransactionId(input.transactionId)
  const expectedHash = input.hash.trim().toLowerCase()
  const username = input.username.trim()
  if (transactionId === null) return invalid('Invalid transaction ID')
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return invalid('Invalid claim hash')
  if (username.length === 0) return invalid('Invalid Hive username')

  const transaction = parseTransaction(rawTransaction)
  if (transaction === null) return invalid('Invalid transaction payload')

  const returnedTransactionId = normalizeTransactionId(
    transaction.transactionId
  )
  if (
    returnedTransactionId === null ||
    returnedTransactionId !== transactionId
  ) {
    return invalid('Transaction ID does not match the requested transaction')
  }

  const transactionTime = Date.parse(transaction.timestamp)
  if (!Number.isFinite(transactionTime)) {
    return invalid('Invalid transaction timestamp')
  }
  if (transactionTime - now > FUTURE_CLOCK_SKEW_MS) {
    return invalid('Transaction timestamp is in the future')
  }
  if (now - transactionTime > MAX_TRANSACTION_AGE_MS) {
    return invalid('The transaction is too old to be valid')
  }

  for (const [operationIndex, operation] of transaction.operations.entries()) {
    if (
      operation.type !== 'custom_json_operation' ||
      operation.value.id !== CLAIM_OPERATION_ID ||
      typeof operation.value.json !== 'string'
    ) {
      continue
    }

    const parsedJson = (() => {
      try {
        return parseClaimJson(JSON.parse(operation.value.json) as unknown)
      } catch {
        return null
      }
    })()
    if (parsedJson === null) continue
    if (!operation.value.requiredPostingAuths.includes(username)) continue
    if (parsedJson.app !== BRAND.CLAIM_APP_ID) continue
    if (parsedJson.hash.toLowerCase() !== expectedHash) continue
    if (parsedJson.username !== username) continue
    if (parsedJson.action !== CLAIM_OPERATION_ID) continue

    return {
      ok: true,
      claim: {
        username,
        hash: expectedHash,
        transactionId,
        operationIndex,
        externalReference: `hive:claim:${transactionId}:${operationIndex}`,
      },
    }
  }

  return invalid('No valid claim_credits operation found in the transaction')
}

async function fetchHiveTransaction(transactionId: string): Promise<unknown> {
  const chain = await hiveChain()
  const extended: TWaxRestExtended<HafahApi> = chain.extendRest({
    'hafah-api': {
      transactions: {
        byId: { urlPath: '{transactionId}' },
      },
    },
  })
  return extended.restApi['hafah-api'].transactions.byId({ transactionId })
}

async function fetchHiveTransactionStatus(
  transactionId: string
): Promise<unknown> {
  const chain = await hiveChain()
  const extended: TWaxExtended<HiveStatusApi> = chain.extend<HiveStatusApi>()
  return extended.api.transaction_status_api.find_transaction({
    transaction_id: transactionId,
  })
}

const defaultHiveClaimProvider: HiveClaimProvider = {
  getStatus: fetchHiveTransactionStatus,
  getTransaction: fetchHiveTransaction,
}

export async function verifyHiveClaim(
  input: HiveClaimVerificationInput,
  provider: HiveClaimProvider = defaultHiveClaimProvider,
  now: number = Date.now()
): Promise<HiveClaimAdapterResult> {
  try {
    const transactionId = normalizeTransactionId(input.transactionId)
    if (transactionId === null) return invalid('Invalid transaction ID')

    const rawStatus = await provider.getStatus(transactionId)
    const status = parseTransactionStatus(rawStatus)
    if (status === null) {
      return unavailable('Hive returned an unknown transaction status')
    }

    if (status === 'unknown' || status === 'within_mempool') {
      return pending('Transaction has not been included in a block yet')
    }

    if (
      status === 'expired_reversible' ||
      status === 'expired_irreversible' ||
      status === 'too_old'
    ) {
      return invalid(`Transaction is no longer claimable (${status})`)
    }

    const rawTransaction = await provider.getTransaction(transactionId)
    const payloadResult = verifyTransactionPayload(rawTransaction, input, now)
    if (!payloadResult.ok) return payloadResult

    if (status === 'within_reversible_block') {
      return pending(
        'Transaction is included and awaiting irreversible confirmation'
      )
    }

    return payloadResult
  } catch (error) {
    return unavailable(
      `Hive transaction provider unavailable: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    )
  }
}

export function createHiveClaimAdapter(
  provider: HiveClaimProvider = defaultHiveClaimProvider
): {
  readonly verify: (
    input: HiveClaimVerificationInput,
    now?: number
  ) => Promise<HiveClaimAdapterResult>
} {
  return {
    verify: (input, now = Date.now()) => verifyHiveClaim(input, provider, now),
  }
}

export { normalizeTransactionId, parseTransaction, verifyTransactionPayload }
