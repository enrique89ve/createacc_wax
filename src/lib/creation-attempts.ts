import { execute } from '@/lib/database'
import {
  CREATION_ATTEMPT_STATUS,
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

export interface CreationAttemptKeys extends ExpectedAccountKeys {}

export interface CreationAttempt {
  readonly correlationId: string
  readonly username: string
  readonly ticket: string
  readonly ticketId: number
  readonly status: CreationAttemptStatus
  readonly keys: CreationAttemptKeys
  readonly transactionId: string | null
  readonly executionMode: HiveExecutionMode
  readonly broadcasted: boolean
  readonly wax: HiveWaxPipelineStatus
  readonly updatedAt: string
}

export interface ReserveCreationAttemptInput {
  readonly correlationId: string
  readonly username: string
  readonly ticket: string
  readonly ticketId: number
  readonly keys: CreationAttemptKeys
  readonly executionMode: HiveExecutionMode
}

export interface PreparedAttemptSnapshot {
  readonly id: string
  readonly wax: HiveWaxPipelineStatus
}

function sqliteBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1'
}

function parseAttemptStatus(value: unknown): CreationAttemptStatus {
  if (value === CREATION_ATTEMPT_STATUS.PREPARED)
    return CREATION_ATTEMPT_STATUS.PREPARED
  if (value === CREATION_ATTEMPT_STATUS.BROADCASTING)
    return CREATION_ATTEMPT_STATUS.BROADCASTING
  if (value === CREATION_ATTEMPT_STATUS.COMPLETED)
    return CREATION_ATTEMPT_STATUS.COMPLETED
  if (value === CREATION_ATTEMPT_STATUS.ROLLED_BACK)
    return CREATION_ATTEMPT_STATUS.ROLLED_BACK
  return CREATION_ATTEMPT_STATUS.RESERVED
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
  return {
    correlationId: String(row.correlation_id),
    username: String(row.username),
    ticket: String(row.ticket),
    ticketId: Number(row.ticket_id),
    status: parseAttemptStatus(row.status),
    keys: {
      ownerPublicKey: String(row.owner_public_key),
      activePublicKey: String(row.active_public_key),
      postingPublicKey: String(row.posting_public_key),
      memoPublicKey: String(row.memo_public_key),
    },
    transactionId:
      typeof row.transaction_id === 'string' ? row.transaction_id : null,
    executionMode: parseExecutionMode(row.execution_mode),
    broadcasted: sqliteBool(row.broadcasted),
    wax: {
      validated: sqliteBool(row.wax_validated),
      onChainVerified: sqliteBool(row.wax_on_chain_verified),
      signed: sqliteBool(row.wax_signed),
      authorityVerified: sqliteBool(row.wax_authority_verified),
    },
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

const ATTEMPT_SELECT = `correlation_id, username, ticket, ticket_id, status,
			owner_public_key, active_public_key, posting_public_key, memo_public_key,
			transaction_id, execution_mode, broadcasted,
			wax_validated, wax_on_chain_verified, wax_signed, wax_authority_verified,
			updated_at`

export async function insertReservedAttempt(
  input: ReserveCreationAttemptInput
): Promise<void> {
  await execute({
    sql: `INSERT INTO CreationAttempts (
			correlation_id, username, ticket, ticket_id, status,
			owner_public_key, active_public_key, posting_public_key, memo_public_key,
			execution_mode
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.correlationId,
      input.username,
      normalizeAttemptTicket(input.ticket),
      input.ticketId,
      CREATION_ATTEMPT_STATUS.RESERVED,
      input.keys.ownerPublicKey,
      input.keys.activePublicKey,
      input.keys.postingPublicKey,
      input.keys.memoPublicKey,
      input.executionMode,
    ],
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

export async function persistAttemptPreparation(
  correlationId: string,
  snapshot: PreparedAttemptSnapshot
): Promise<boolean> {
  const result = await execute({
    sql: `UPDATE CreationAttempts
			SET transaction_id = ?,
			    wax_validated = ?,
			    wax_on_chain_verified = ?,
			    wax_signed = ?,
			    wax_authority_verified = ?,
			    status = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE correlation_id = ? AND status IN (?, ?)
			RETURNING correlation_id`,
    args: [
      snapshot.id,
      snapshot.wax.validated ? 1 : 0,
      snapshot.wax.onChainVerified ? 1 : 0,
      snapshot.wax.signed ? 1 : 0,
      snapshot.wax.authorityVerified ? 1 : 0,
      CREATION_ATTEMPT_STATUS.PREPARED,
      correlationId,
      CREATION_ATTEMPT_STATUS.RESERVED,
      CREATION_ATTEMPT_STATUS.PREPARED,
    ],
  })
  return result.rows.length > 0
}

export async function persistAttemptBroadcastOutcome(
  correlationId: string,
  tx: HiveTransactionResult
): Promise<void> {
  await execute({
    sql: `UPDATE CreationAttempts
			SET transaction_id = ?,
			    execution_mode = ?,
			    broadcasted = ?,
			    wax_validated = ?,
			    wax_on_chain_verified = ?,
			    wax_signed = ?,
			    wax_authority_verified = ?,
			    status = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE correlation_id = ? AND status IN (?, ?, ?)`,
    args: [
      tx.id,
      tx.mode,
      tx.broadcasted ? 1 : 0,
      tx.wax.validated ? 1 : 0,
      tx.wax.onChainVerified ? 1 : 0,
      tx.wax.signed ? 1 : 0,
      tx.wax.authorityVerified ? 1 : 0,
      tx.broadcasted
        ? CREATION_ATTEMPT_STATUS.BROADCASTING
        : CREATION_ATTEMPT_STATUS.PREPARED,
      correlationId,
      CREATION_ATTEMPT_STATUS.RESERVED,
      CREATION_ATTEMPT_STATUS.PREPARED,
      CREATION_ATTEMPT_STATUS.BROADCASTING,
    ],
  })
}

export async function markAttemptBroadcasting(
  correlationId: string
): Promise<boolean> {
  const result = await execute({
    sql: `UPDATE CreationAttempts
			SET status = ?, updated_at = CURRENT_TIMESTAMP
			WHERE correlation_id = ? AND status = ?
			RETURNING correlation_id`,
    args: [
      CREATION_ATTEMPT_STATUS.BROADCASTING,
      correlationId,
      CREATION_ATTEMPT_STATUS.PREPARED,
    ],
  })
  return result.rows.length > 0
}

export async function markAttemptCompleted(
  correlationId: string
): Promise<void> {
  await execute({
    sql: `UPDATE CreationAttempts
			SET status = ?, updated_at = CURRENT_TIMESTAMP
			WHERE correlation_id = ? AND status IN (?, ?, ?)`,
    args: [
      CREATION_ATTEMPT_STATUS.COMPLETED,
      correlationId,
      ...OPEN_CREATION_ATTEMPT_STATUSES,
    ],
  })
}

export async function markAttemptRecoveredOnChain(
  correlationId: string
): Promise<void> {
  await execute({
    sql: `UPDATE CreationAttempts
			SET broadcasted = 1,
			    status = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE correlation_id = ?`,
    args: [CREATION_ATTEMPT_STATUS.COMPLETED, correlationId],
  })
}

export async function markAttemptRolledBack(
  correlationId: string
): Promise<boolean> {
  const result = await execute({
    sql: `UPDATE CreationAttempts
			SET status = ?, updated_at = CURRENT_TIMESTAMP
			WHERE correlation_id = ? AND status IN (?, ?, ?)
			RETURNING correlation_id`,
    args: [
      CREATION_ATTEMPT_STATUS.ROLLED_BACK,
      correlationId,
      ...OPEN_CREATION_ATTEMPT_STATUSES,
    ],
  })
  return result.rows.length > 0
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
