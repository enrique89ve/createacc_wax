import { execute, executeWrite, withTransaction } from '@/lib/database'
import {
  CREATION_ATTEMPT_EVENT_TYPES,
  type CreationAttemptEventType,
} from '@/consts/creation-attempt-events'
import {
  CREATION_ATTEMPT_STATUS,
  HIVE_TX_MODE_VALUES,
  OPEN_CREATION_ATTEMPT_STATUSES,
  WAX_STATUS,
  type CreationAttemptStatus,
  type HiveExecutionMode,
} from '@/consts/hive-execution'
import { parseExecutionMode } from '@/lib/account-status'
import {
  waxPipelinePassed,
  type HiveTransactionResult,
  type HiveWaxPipelineStatus,
} from '@/types/hive-transaction'
import type { ExpectedAccountKeys } from '@/lib/hive-account-authorities'
import type { TicketFundingSource } from '@/types/database'

export interface CreationAttemptKeys extends ExpectedAccountKeys {}

export interface CreationAttempt {
  readonly correlationId: string
  readonly username: string
  readonly ticket: string
  readonly ticketId: number
  readonly fundingSource: TicketFundingSource
  readonly ownerBuilderUsername: string | null
  readonly version: number
  readonly leaseToken: string | null
  readonly leaseExpiresAt: string | null
  readonly leaseGeneration: number
  readonly status: CreationAttemptStatus
  readonly keys: CreationAttemptKeys
  readonly transactionId: string | null
  readonly transactionExpiresAt: string | null
  readonly executionMode: HiveExecutionMode
  readonly broadcasted: boolean
  readonly wax: HiveWaxPipelineStatus
  readonly updatedAt: string
}

export interface CreationAttemptLease {
  readonly correlationId: string
  readonly token: string
  readonly version: number
  readonly generation: number
}

const ATTEMPT_LEASE_DURATION_SECONDS = 120

export interface ReserveCreationAttemptInput {
  readonly correlationId: string
  readonly username: string
  readonly ticket: string
  readonly ticketId: number
  readonly fundingSource: TicketFundingSource
  readonly ownerBuilderUsername: string | null
  readonly keys: CreationAttemptKeys
  readonly executionMode: HiveExecutionMode
}

export interface PreparedAttemptSnapshot {
  readonly id: string
  readonly expiration: string
  readonly wax: HiveWaxPipelineStatus
}

function sqliteBool(value: unknown): boolean {
  if (value === 1 || value === true || value === '1') return true
  if (value === 0 || value === false || value === '0') return false
  throw new Error('Invalid SQLite boolean on creation attempt')
}

function parseAttemptStatus(value: unknown): CreationAttemptStatus {
  if (value === CREATION_ATTEMPT_STATUS.PREPARED) {
    return CREATION_ATTEMPT_STATUS.PREPARED
  }
  if (value === CREATION_ATTEMPT_STATUS.BROADCASTING) {
    return CREATION_ATTEMPT_STATUS.BROADCASTING
  }
  if (value === CREATION_ATTEMPT_STATUS.COMPLETED) {
    return CREATION_ATTEMPT_STATUS.COMPLETED
  }
  if (value === CREATION_ATTEMPT_STATUS.ROLLED_BACK) {
    return CREATION_ATTEMPT_STATUS.ROLLED_BACK
  }
  if (value === CREATION_ATTEMPT_STATUS.RESERVED) {
    return CREATION_ATTEMPT_STATUS.RESERVED
  }
  throw new Error('Invalid status on creation attempt')
}

function requiredAttemptText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid ${field} on creation attempt`)
  }
  return value
}

export function normalizeAttemptTicket(ticket: string): string {
  return ticket.trim().toUpperCase()
}

export function isOpenCreationAttempt(status: CreationAttemptStatus): boolean {
  return (OPEN_CREATION_ATTEMPT_STATUSES as readonly string[]).includes(status)
}

export function isAttemptStale(updatedAt: string, staleMs: number): boolean {
  const normalized = updatedAt.includes('T')
    ? updatedAt
    : updatedAt.replace(' ', 'T')
  const timestamp = Date.parse(
    normalized.endsWith('Z') ? normalized : `${normalized}Z`
  )
  if (!Number.isFinite(timestamp)) return false
  return Date.now() - timestamp >= staleMs
}

function parseAttemptRow(row: Record<string, unknown>): CreationAttempt {
  const correlationId = requiredAttemptText(
    row.correlation_id,
    'correlation_id'
  )
  const username = requiredAttemptText(row.username, 'username')
  const ticket = requiredAttemptText(row.ticket, 'ticket')
  const ticketId = Number(row.ticket_id)
  const version = Number(row.version)
  const leaseGeneration = Number(row.lease_generation)
  const executionMode = row.execution_mode
  const transactionId =
    typeof row.transaction_id === 'string' ? row.transaction_id : null
  const transactionExpiresAt =
    typeof row.transaction_expires_at === 'string'
      ? row.transaction_expires_at
      : null
  const keys: CreationAttemptKeys = {
    ownerPublicKey: requiredAttemptText(
      row.owner_public_key,
      'owner_public_key'
    ),
    activePublicKey: requiredAttemptText(
      row.active_public_key,
      'active_public_key'
    ),
    postingPublicKey: requiredAttemptText(
      row.posting_public_key,
      'posting_public_key'
    ),
    memoPublicKey: requiredAttemptText(row.memo_public_key, 'memo_public_key'),
  }
  const updatedAt = requiredAttemptText(row.updated_at, 'updated_at')
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) {
    throw new Error('Invalid ticket_id on creation attempt')
  }
  if (
    !Number.isSafeInteger(version) ||
    version < 0 ||
    !Number.isSafeInteger(leaseGeneration) ||
    leaseGeneration < 0
  ) {
    throw new Error('Invalid version or lease generation on creation attempt')
  }
  const leaseToken =
    typeof row.lease_token === 'string' ? row.lease_token : null
  const leaseExpiresAt =
    typeof row.lease_expires_at === 'string' ? row.lease_expires_at : null
  if ((leaseToken === null) !== (leaseExpiresAt === null)) {
    throw new Error('Incomplete lease on creation attempt')
  }
  if (
    executionMode !== HIVE_TX_MODE_VALUES.SIMULATE &&
    executionMode !== HIVE_TX_MODE_VALUES.BROADCAST
  ) {
    throw new Error('Invalid execution_mode on creation attempt')
  }
  if (row.transaction_id !== null && typeof row.transaction_id !== 'string') {
    throw new Error('Invalid transaction_id on creation attempt')
  }
  if (
    row.transaction_expires_at !== null &&
    typeof row.transaction_expires_at !== 'string'
  ) {
    throw new Error('Invalid transaction expiration on creation attempt')
  }
  if (
    transactionExpiresAt !== null &&
    !Number.isFinite(Date.parse(transactionExpiresAt))
  ) {
    throw new Error('Invalid transaction expiration on creation attempt')
  }

  const fundingSource = row.funding_source
  const ownerBuilderUsername =
    typeof row.owner_builder_username === 'string'
      ? row.owner_builder_username
      : null
  if (
    (fundingSource !== 'builder_credits' && fundingSource !== 'system') ||
    (fundingSource === 'builder_credits' &&
      (!ownerBuilderUsername || ownerBuilderUsername.trim().length === 0)) ||
    (fundingSource === 'system' && ownerBuilderUsername !== null)
  ) {
    throw new Error('Invalid ticket funding snapshot on creation attempt')
  }

  return {
    correlationId,
    username,
    ticket,
    ticketId,
    fundingSource,
    ownerBuilderUsername,
    version,
    leaseToken,
    leaseExpiresAt,
    leaseGeneration,
    status: parseAttemptStatus(row.status),
    keys,
    transactionId,
    transactionExpiresAt,
    executionMode: parseExecutionMode(executionMode),
    broadcasted: sqliteBool(row.broadcasted),
    wax: {
      validated: sqliteBool(row.wax_validated),
      onChainVerified: sqliteBool(row.wax_on_chain_verified),
      signed: sqliteBool(row.wax_signed),
      authorityVerified: sqliteBool(row.wax_authority_verified),
    },
    updatedAt,
  }
}

function leaseFromResult(
  correlationId: string,
  row: Record<string, unknown> | undefined
): CreationAttemptLease | null {
  if (!row) return null
  const token = row.lease_token
  const version = Number(row.version)
  const generation = Number(row.lease_generation)
  if (
    typeof token !== 'string' ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    !Number.isSafeInteger(generation) ||
    generation < 1
  ) {
    throw new Error('Invalid claimed lease on creation attempt')
  }
  return { correlationId, token, version, generation }
}

const ATTEMPT_SELECT = `correlation_id, username, ticket, ticket_id,
			funding_source, owner_builder_username, version, lease_token,
			lease_expires_at, lease_generation, status,
			owner_public_key, active_public_key, posting_public_key, memo_public_key,
			transaction_id, transaction_expires_at, execution_mode, broadcasted,
			wax_validated, wax_on_chain_verified, wax_signed, wax_authority_verified,
			updated_at`

interface CreationAttemptEventInput {
  readonly correlationId: string
  readonly ticketId: number
  readonly username: string
  readonly eventType: CreationAttemptEventType
  readonly fromStatus: CreationAttemptStatus | null
  readonly toStatus: CreationAttemptStatus
  readonly version: number
  readonly leaseGeneration: number
  readonly transactionId?: string | null
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>
  readonly operationReference: string
}

async function insertCreationAttemptEvent(
  input: CreationAttemptEventInput
): Promise<void> {
  await executeWrite({
    sql: `INSERT INTO CreationAttemptEvents (
            correlation_id, ticket_id, username, event_type, from_status,
            to_status, version, lease_generation, transaction_id, detail_json,
            operation_reference
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.correlationId,
      input.ticketId,
      input.username,
      input.eventType,
      input.fromStatus,
      input.toStatus,
      input.version,
      input.leaseGeneration,
      input.transactionId ?? null,
      input.detail ? JSON.stringify(input.detail) : null,
      input.operationReference,
    ],
  })
}

export async function insertReservedAttempt(
  input: ReserveCreationAttemptInput
): Promise<void> {
  await withTransaction(async () => {
    await executeWrite({
      sql: `INSERT INTO CreationAttempts (
			correlation_id, username, ticket, ticket_id, status,
			funding_source, owner_builder_username,
			owner_public_key, active_public_key, posting_public_key, memo_public_key,
			execution_mode
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.correlationId,
        input.username,
        normalizeAttemptTicket(input.ticket),
        input.ticketId,
        CREATION_ATTEMPT_STATUS.RESERVED,
        input.fundingSource,
        input.ownerBuilderUsername,
        input.keys.ownerPublicKey,
        input.keys.activePublicKey,
        input.keys.postingPublicKey,
        input.keys.memoPublicKey,
        input.executionMode,
      ],
    })
    await insertCreationAttemptEvent({
      correlationId: input.correlationId,
      ticketId: input.ticketId,
      username: input.username,
      eventType: CREATION_ATTEMPT_EVENT_TYPES.RESERVED,
      fromStatus: null,
      toStatus: CREATION_ATTEMPT_STATUS.RESERVED,
      version: 0,
      leaseGeneration: 0,
      operationReference: `attempt:${input.correlationId}:reserved`,
    })
  })
}

export async function getCreationAttempt(
  correlationId: string
): Promise<CreationAttempt | null> {
  const result = await execute({
    sql: `SELECT ${ATTEMPT_SELECT} FROM CreationAttempts WHERE correlation_id = ?`,
    args: [correlationId],
  })
  if (result.rows.length === 0) return null
  return parseAttemptRow(result.rows[0] as Record<string, unknown>)
}

export async function findOpenCreationAttempt(params: {
  readonly username: string
  readonly ticket: string
  readonly keys: CreationAttemptKeys
}): Promise<CreationAttempt | null> {
  const result = await execute({
    sql: `SELECT ${ATTEMPT_SELECT}
			FROM CreationAttempts
			WHERE username = ?
			  AND ticket = ?
			  AND owner_public_key = ?
			  AND active_public_key = ?
			  AND posting_public_key = ?
			  AND memo_public_key = ?
			  AND status IN (?, ?, ?)
			ORDER BY created_at DESC
			LIMIT 1`,
    args: [
      params.username,
      normalizeAttemptTicket(params.ticket),
      params.keys.ownerPublicKey,
      params.keys.activePublicKey,
      params.keys.postingPublicKey,
      params.keys.memoPublicKey,
      ...OPEN_CREATION_ATTEMPT_STATUSES,
    ],
  })
  if (result.rows.length === 0) return null
  return parseAttemptRow(result.rows[0] as Record<string, unknown>)
}

/** Claim one open attempt. The generation fences every previous owner. */
export async function claimCreationAttempt(
  correlationId: string
): Promise<CreationAttemptLease | null> {
  const token = crypto.randomUUID()
  const result = await execute({
    sql: `UPDATE CreationAttempts
			SET lease_token = ?,
			    lease_expires_at = datetime('now', '+${ATTEMPT_LEASE_DURATION_SECONDS} seconds'),
			    lease_generation = lease_generation + 1,
			    version = version + 1,
			    updated_at = CURRENT_TIMESTAMP
			WHERE correlation_id = ?
			  AND status IN (?, ?, ?)
			  AND (lease_token IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP)
			RETURNING correlation_id, lease_token, version, lease_generation`,
    args: [token, correlationId, ...OPEN_CREATION_ATTEMPT_STATUSES],
  })
  return leaseFromResult(
    correlationId,
    result.rows[0] as Record<string, unknown> | undefined
  )
}

/** Renew a still-valid lease and return its next CAS version. */
export async function renewCreationAttemptLease(
  lease: CreationAttemptLease
): Promise<CreationAttemptLease | null> {
  const result = await execute({
    sql: `UPDATE CreationAttempts
			SET lease_expires_at = datetime('now', '+${ATTEMPT_LEASE_DURATION_SECONDS} seconds'),
			    version = version + 1,
			    updated_at = CURRENT_TIMESTAMP
			WHERE correlation_id = ? AND lease_token = ? AND version = ?
			  AND lease_generation = ? AND lease_expires_at > CURRENT_TIMESTAMP
			  AND status IN (?, ?, ?)
			RETURNING correlation_id, lease_token, version, lease_generation`,
    args: [
      lease.correlationId,
      lease.token,
      lease.version,
      lease.generation,
      ...OPEN_CREATION_ATTEMPT_STATUSES,
    ],
  })
  return leaseFromResult(
    lease.correlationId,
    result.rows[0] as Record<string, unknown> | undefined
  )
}

/** Release an undecided attempt after a read-only evidence lookup. */
export async function releaseCreationAttemptLease(
  lease: CreationAttemptLease
): Promise<boolean> {
  const result = await execute({
    sql: `UPDATE CreationAttempts
			SET lease_token = NULL, lease_expires_at = NULL,
			    version = version + 1, updated_at = CURRENT_TIMESTAMP
			WHERE correlation_id = ? AND lease_token = ? AND version = ?
			  AND lease_generation = ? AND lease_expires_at > CURRENT_TIMESTAMP
			  AND status IN (?, ?, ?)
			RETURNING correlation_id`,
    args: [
      lease.correlationId,
      lease.token,
      lease.version,
      lease.generation,
      ...OPEN_CREATION_ATTEMPT_STATUSES,
    ],
  })
  return result.rows.length === 1
}

function leasePredicate(lease: CreationAttemptLease): {
  readonly sql: string
  readonly args: readonly (string | number)[]
} {
  return {
    sql: `correlation_id = ? AND lease_token = ? AND version = ?
			  AND lease_generation = ? AND lease_expires_at > CURRENT_TIMESTAMP`,
    args: [lease.correlationId, lease.token, lease.version, lease.generation],
  }
}

function nextLeaseFromUpdate(
  lease: CreationAttemptLease,
  result: { readonly rows: readonly Record<string, unknown>[] }
): CreationAttemptLease | null {
  return leaseFromResult(lease.correlationId, result.rows[0])
}

export async function persistAttemptPreparation(
  lease: CreationAttemptLease,
  snapshot: PreparedAttemptSnapshot
): Promise<CreationAttemptLease | null> {
  if (
    typeof snapshot.expiration !== 'string' ||
    !Number.isFinite(Date.parse(snapshot.expiration))
  ) {
    throw new Error('Invalid prepared transaction expiration')
  }
  return withTransaction(async () => {
    const attempt = await getCreationAttempt(lease.correlationId)
    if (!attempt) return null
    const predicate = leasePredicate(lease)
    const result = await executeWrite({
      sql: `UPDATE CreationAttempts
			SET transaction_id = ?,
			    wax_validated = ?,
			    wax_on_chain_verified = ?,
			    wax_signed = ?,
			    wax_authority_verified = ?,
			    transaction_expires_at = ?,
			    status = ?,
			    lease_expires_at = datetime('now', '+${ATTEMPT_LEASE_DURATION_SECONDS} seconds'),
			    version = version + 1,
			    updated_at = CURRENT_TIMESTAMP
			WHERE ${predicate.sql} AND status = ?
			RETURNING correlation_id, lease_token, version, lease_generation`,
      args: [
        snapshot.id,
        snapshot.wax.validated ? 1 : 0,
        snapshot.wax.onChainVerified ? 1 : 0,
        snapshot.wax.signed ? 1 : 0,
        snapshot.wax.authorityVerified ? 1 : 0,
        snapshot.expiration,
        CREATION_ATTEMPT_STATUS.PREPARED,
        ...predicate.args,
        CREATION_ATTEMPT_STATUS.RESERVED,
      ],
    })
    const nextLease = nextLeaseFromUpdate(lease, result)
    if (nextLease) {
      await insertCreationAttemptEvent({
        correlationId: attempt.correlationId,
        ticketId: attempt.ticketId,
        username: attempt.username,
        eventType: CREATION_ATTEMPT_EVENT_TYPES.PREPARED,
        fromStatus: CREATION_ATTEMPT_STATUS.RESERVED,
        toStatus: CREATION_ATTEMPT_STATUS.PREPARED,
        version: nextLease.version,
        leaseGeneration: nextLease.generation,
        transactionId: snapshot.id,
        detail: {
          expiration: snapshot.expiration,
          waxValidated: snapshot.wax.validated,
          onChainVerified: snapshot.wax.onChainVerified,
          signed: snapshot.wax.signed,
          authorityVerified: snapshot.wax.authorityVerified,
        },
        operationReference: `attempt:${attempt.correlationId}:prepared`,
      })
    }
    return nextLease
  })
}

export async function persistAttemptBroadcastOutcome(
  lease: CreationAttemptLease,
  tx: HiveTransactionResult
): Promise<CreationAttemptLease | null> {
  return withTransaction(async () => {
    const attempt = await getCreationAttempt(lease.correlationId)
    if (!attempt) return null
    const predicate = leasePredicate(lease)
    const result = await executeWrite({
      sql: `UPDATE CreationAttempts
			SET broadcasted = ?,
			    wax_validated = ?,
			    wax_on_chain_verified = ?,
			    wax_signed = ?,
			    wax_authority_verified = ?,
			    status = ?,
			    lease_expires_at = datetime('now', '+${ATTEMPT_LEASE_DURATION_SECONDS} seconds'),
			    version = version + 1,
			    updated_at = CURRENT_TIMESTAMP
			WHERE ${predicate.sql} AND transaction_id = ?
			  AND execution_mode = ? AND status IN (?, ?, ?)
			RETURNING correlation_id, lease_token, version, lease_generation`,
      args: [
        tx.broadcasted ? 1 : 0,
        tx.wax.validated ? 1 : 0,
        tx.wax.onChainVerified ? 1 : 0,
        tx.wax.signed ? 1 : 0,
        tx.wax.authorityVerified ? 1 : 0,
        tx.broadcasted
          ? CREATION_ATTEMPT_STATUS.BROADCASTING
          : CREATION_ATTEMPT_STATUS.PREPARED,
        ...predicate.args,
        tx.id,
        tx.mode,
        CREATION_ATTEMPT_STATUS.RESERVED,
        CREATION_ATTEMPT_STATUS.PREPARED,
        CREATION_ATTEMPT_STATUS.BROADCASTING,
      ],
    })
    const nextLease = nextLeaseFromUpdate(lease, result)
    if (nextLease) {
      await insertCreationAttemptEvent({
        correlationId: attempt.correlationId,
        ticketId: attempt.ticketId,
        username: attempt.username,
        eventType: CREATION_ATTEMPT_EVENT_TYPES.BROADCAST_RESULT,
        fromStatus: attempt.status,
        toStatus: tx.broadcasted
          ? CREATION_ATTEMPT_STATUS.BROADCASTING
          : CREATION_ATTEMPT_STATUS.PREPARED,
        version: nextLease.version,
        leaseGeneration: nextLease.generation,
        transactionId: tx.id,
        detail: {
          broadcasted: tx.broadcasted,
          mode: tx.mode,
          waxValidated: tx.wax.validated,
          onChainVerified: tx.wax.onChainVerified,
          signed: tx.wax.signed,
          authorityVerified: tx.wax.authorityVerified,
        },
        operationReference: `attempt:${attempt.correlationId}:broadcast-result:${tx.id}:v${nextLease.version}`,
      })
    }
    return nextLease
  })
}

export async function markAttemptBroadcasting(
  lease: CreationAttemptLease
): Promise<CreationAttemptLease | null> {
  return withTransaction(async () => {
    const attempt = await getCreationAttempt(lease.correlationId)
    if (!attempt) return null
    const predicate = leasePredicate(lease)
    const result = await executeWrite({
      sql: `UPDATE CreationAttempts
			SET status = ?,
			    lease_expires_at = datetime('now', '+${ATTEMPT_LEASE_DURATION_SECONDS} seconds'),
			    version = version + 1,
			    updated_at = CURRENT_TIMESTAMP
			WHERE ${predicate.sql} AND status = ?
			RETURNING correlation_id, lease_token, version, lease_generation`,
      args: [
        CREATION_ATTEMPT_STATUS.BROADCASTING,
        ...predicate.args,
        CREATION_ATTEMPT_STATUS.PREPARED,
      ],
    })
    const nextLease = nextLeaseFromUpdate(lease, result)
    if (nextLease) {
      await insertCreationAttemptEvent({
        correlationId: attempt.correlationId,
        ticketId: attempt.ticketId,
        username: attempt.username,
        eventType: CREATION_ATTEMPT_EVENT_TYPES.BROADCAST_AUTHORIZED,
        fromStatus: CREATION_ATTEMPT_STATUS.PREPARED,
        toStatus: CREATION_ATTEMPT_STATUS.BROADCASTING,
        version: nextLease.version,
        leaseGeneration: nextLease.generation,
        transactionId: attempt.transactionId,
        detail: { expiration: attempt.transactionExpiresAt },
        operationReference: `attempt:${attempt.correlationId}:broadcast-authorized:v${nextLease.version}`,
      })
    }
    return nextLease
  })
}

export async function markAttemptCompleted(
  lease: CreationAttemptLease
): Promise<boolean> {
  return withTransaction(async () => {
    const attempt = await getCreationAttempt(lease.correlationId)
    if (!attempt) return false
    const predicate = leasePredicate(lease)
    const result = await executeWrite({
      sql: `UPDATE CreationAttempts
			SET status = ?, lease_token = NULL, lease_expires_at = NULL,
			    version = version + 1, updated_at = CURRENT_TIMESTAMP
			WHERE ${predicate.sql} AND status IN (?, ?, ?)
			RETURNING correlation_id`,
      args: [
        CREATION_ATTEMPT_STATUS.COMPLETED,
        ...predicate.args,
        ...OPEN_CREATION_ATTEMPT_STATUSES,
      ],
    })
    if (result.rows.length !== 1) return false
    await insertCreationAttemptEvent({
      correlationId: attempt.correlationId,
      ticketId: attempt.ticketId,
      username: attempt.username,
      eventType: CREATION_ATTEMPT_EVENT_TYPES.COMPLETED,
      fromStatus: attempt.status,
      toStatus: CREATION_ATTEMPT_STATUS.COMPLETED,
      version: lease.version + 1,
      leaseGeneration: lease.generation,
      transactionId: attempt.transactionId,
      operationReference: `attempt:${attempt.correlationId}:completed`,
    })
    return true
  })
}

export async function markAttemptRolledBack(
  lease: CreationAttemptLease
): Promise<boolean> {
  return withTransaction(async () => {
    const attempt = await getCreationAttempt(lease.correlationId)
    if (!attempt) return false
    const predicate = leasePredicate(lease)
    const result = await executeWrite({
      sql: `UPDATE CreationAttempts
			SET status = ?, lease_token = NULL, lease_expires_at = NULL,
			    version = version + 1, updated_at = CURRENT_TIMESTAMP
			WHERE ${predicate.sql} AND status IN (?, ?, ?)
			RETURNING correlation_id`,
      args: [
        CREATION_ATTEMPT_STATUS.ROLLED_BACK,
        ...predicate.args,
        ...OPEN_CREATION_ATTEMPT_STATUSES,
      ],
    })
    if (result.rows.length !== 1) return false
    await insertCreationAttemptEvent({
      correlationId: attempt.correlationId,
      ticketId: attempt.ticketId,
      username: attempt.username,
      eventType: CREATION_ATTEMPT_EVENT_TYPES.ROLLED_BACK,
      fromStatus: attempt.status,
      toStatus: CREATION_ATTEMPT_STATUS.ROLLED_BACK,
      version: lease.version + 1,
      leaseGeneration: lease.generation,
      transactionId: attempt.transactionId,
      operationReference: `attempt:${attempt.correlationId}:rolled-back`,
    })
    return true
  })
}

export async function getOpenCreationAttemptByUsername(
  username: string
): Promise<CreationAttempt | null> {
  const result = await execute({
    sql: `SELECT ${ATTEMPT_SELECT}
			FROM CreationAttempts
			WHERE username = ? AND status IN (?, ?, ?)
			ORDER BY created_at DESC
			LIMIT 1`,
    args: [username, ...OPEN_CREATION_ATTEMPT_STATUSES],
  })
  if (result.rows.length === 0) return null
  return parseAttemptRow(result.rows[0] as Record<string, unknown>)
}

export async function listOpenCreationAttempts(): Promise<CreationAttempt[]> {
  const result = await execute({
    sql: `SELECT ${ATTEMPT_SELECT}
			FROM CreationAttempts
			WHERE status IN (?, ?, ?)
			ORDER BY updated_at ASC`,
    args: [...OPEN_CREATION_ATTEMPT_STATUSES],
  })
  return result.rows.map(row => parseAttemptRow(row as Record<string, unknown>))
}

export function hiveTransactionFromAttempt(
  attempt: CreationAttempt
): HiveTransactionResult | null {
  if (!attempt.transactionId) return null
  return {
    id: attempt.transactionId,
    mode: attempt.executionMode,
    broadcasted: attempt.broadcasted,
    wax: attempt.wax,
    requiredAuthorities: {},
    signaturePublicKeys: [],
  }
}

export function hiveTransactionFromRecoveredAttempt(
  attempt: CreationAttempt
): HiveTransactionResult | null {
  const tx = hiveTransactionFromAttempt(attempt)
  if (!tx) return null
  return { ...tx, broadcasted: true }
}

export function waxStatusFromAttempt(attempt: CreationAttempt): string | null {
  if (!attempt.transactionId) return null
  return waxPipelinePassed(attempt.wax) ? WAX_STATUS.PASSED : WAX_STATUS.FAILED
}
