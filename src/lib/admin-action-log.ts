import { createHash } from 'node:crypto'
import { execute } from './database'
import { Permission } from './auth/permissions'

export type AdminJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly AdminJsonValue[]
  | { readonly [key: string]: AdminJsonValue }

export const ADMIN_ACTION_POLICY_VERSION = 1

export const ADMIN_MUTATION_ACTIONS = [
  Permission.ASSIGN_CREDITS,
  Permission.ADJUST_CREDITS,
  Permission.BLOCK_BUILDER,
  Permission.REACTIVATE_BUILDER,
  Permission.CREATE_ADMIN_TICKET,
] as const

export type AdminMutationAction = (typeof ADMIN_MUTATION_ACTIONS)[number]

export const ADMIN_ACTION_TARGET_TYPES = [
  'builder',
  'credits',
  'ticket',
] as const

export type AdminActionTargetType = (typeof ADMIN_ACTION_TARGET_TYPES)[number]

export const ADMIN_ACTION_OUTCOMES = ['applied', 'unchanged'] as const
export type AdminActionOutcome = (typeof ADMIN_ACTION_OUTCOMES)[number]

export interface AdminActionReceiptRecord {
  readonly id: number
  readonly actor_user_id: string
  readonly actor_username: string
  readonly request_id: string
  readonly action: AdminMutationAction
  readonly target_type: AdminActionTargetType
  readonly target_id: string
  readonly request_hash: string
  readonly policy_version: number
  readonly reason: string | null
  readonly outcome: AdminActionOutcome
  readonly before_state: AdminJsonValue | null
  readonly after_state: AdminJsonValue | null
  readonly receipt: AdminJsonValue
  readonly created_at: string
}

export interface AppendAdminActionReceiptParams {
  readonly actorUserId: string
  readonly actorUsername: string
  readonly requestId: string
  readonly action: AdminMutationAction
  readonly targetType: AdminActionTargetType
  readonly targetId: string
  readonly requestHash: string
  readonly policyVersion?: number
  readonly reason?: string
  readonly outcome: AdminActionOutcome
  readonly beforeState?: AdminJsonValue | null
  readonly afterState?: AdminJsonValue | null
  readonly receipt: AdminJsonValue
}

function canonicalJson(value: AdminJsonValue): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Admin action payload contains a non-finite number')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item)).join(',')}]`
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`
}

export function hashAdminActionCommand(params: {
  readonly action: AdminMutationAction
  readonly targetType: AdminActionTargetType
  readonly targetId: string
  readonly normalizedCommand: AdminJsonValue
}): string {
  const canonicalCommand = canonicalJson([
    params.action,
    params.targetType,
    params.targetId,
    params.normalizedCommand,
  ])
  return createHash('sha256').update(canonicalCommand).digest('hex')
}

function parseJsonValue(value: unknown, fieldName: string): AdminJsonValue {
  if (typeof value !== 'string') {
    throw new Error(`Admin action ${fieldName} is not serialized JSON`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`Admin action ${fieldName} contains invalid JSON`)
  }
  if (!isAdminJsonValue(parsed)) {
    throw new Error(`Admin action ${fieldName} is not a JSON value`)
  }
  return parsed
}

function isAdminJsonValue(value: unknown): value is AdminJsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return true
  }
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isAdminJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isAdminJsonValue)
}

function parseAdminActionRecord(
  row: Record<string, unknown>
): AdminActionReceiptRecord {
  const id = Number(row.id)
  const policyVersion = Number(row.policy_version)
  const actionValues: readonly string[] = ADMIN_MUTATION_ACTIONS
  const outcome = String(row.outcome)
  const targetType = String(row.target_type)
  const requestHash = String(row.request_hash)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Admin action record has an invalid id')
  }
  if (!Number.isSafeInteger(policyVersion) || policyVersion <= 0) {
    throw new Error('Admin action record has an invalid policy version')
  }
  if (!actionValues.includes(String(row.action))) {
    throw new Error('Admin action record has an unknown action')
  }
  if (!ADMIN_ACTION_OUTCOMES.includes(outcome as AdminActionOutcome)) {
    throw new Error('Admin action record has an unknown outcome')
  }
  if (
    !ADMIN_ACTION_TARGET_TYPES.includes(targetType as AdminActionTargetType)
  ) {
    throw new Error('Admin action record has an unknown target type')
  }
  if (!/^[a-f0-9]{64}$/.test(requestHash)) {
    throw new Error('Admin action record has an invalid request hash')
  }
  if (
    typeof row.actor_user_id !== 'string' ||
    typeof row.actor_username !== 'string' ||
    typeof row.request_id !== 'string' ||
    typeof row.target_id !== 'string' ||
    typeof row.created_at !== 'string'
  ) {
    throw new Error('Admin action record has an invalid identity field')
  }

  const reason = row.reason
  if (reason !== null && typeof reason !== 'string') {
    throw new Error('Admin action record has an invalid reason')
  }
  const beforeState =
    row.before_state === null
      ? null
      : parseJsonValue(row.before_state, 'before_state')
  const afterState =
    row.after_state === null
      ? null
      : parseJsonValue(row.after_state, 'after_state')
  return {
    id,
    actor_user_id: row.actor_user_id,
    actor_username: row.actor_username,
    request_id: row.request_id,
    action: row.action as AdminMutationAction,
    target_type: targetType as AdminActionTargetType,
    target_id: row.target_id,
    request_hash: requestHash,
    policy_version: policyVersion,
    reason,
    outcome: outcome as AdminActionOutcome,
    before_state: beforeState,
    after_state: afterState,
    receipt: parseJsonValue(row.receipt, 'receipt'),
    created_at: row.created_at,
  }
}

const ADMIN_ACTION_SELECT = `
  SELECT id, actor_user_id, actor_username, request_id, action, target_type,
    target_id, request_hash, policy_version, reason, outcome, before_state,
    after_state, receipt, created_at
  FROM AdminActionLog
`

export async function findAdminActionReceipt(params: {
  readonly actorUserId: string
  readonly requestId: string
}): Promise<AdminActionReceiptRecord | null> {
  const result = await execute({
    sql: `${ADMIN_ACTION_SELECT}
      WHERE actor_user_id = ? AND request_id = ?
      LIMIT 1`,
    args: [params.actorUserId, params.requestId],
  })
  if (result.rows.length === 0) return null
  return parseAdminActionRecord(result.rows[0] as Record<string, unknown>)
}

export async function appendAdminActionReceipt(
  params: AppendAdminActionReceiptParams
): Promise<number> {
  const requestId = params.requestId.trim()
  const targetId = params.targetId.trim()
  const requestHash = params.requestHash.toLowerCase()
  const policyVersion = params.policyVersion ?? ADMIN_ACTION_POLICY_VERSION
  if (requestId.length === 0 || targetId.length === 0) {
    throw new Error('Admin action requires a request ID and target ID')
  }
  if (!/^[a-f0-9]{64}$/.test(requestHash)) {
    throw new Error('Admin action request hash must be a SHA-256 hex digest')
  }
  if (!Number.isSafeInteger(policyVersion) || policyVersion <= 0) {
    throw new Error('Admin action policy version must be a positive integer')
  }

  const beforeState = params.beforeState ?? null
  const afterState = params.afterState ?? null
  const result = await execute({
    sql: `INSERT INTO AdminActionLog (
      actor_user_id, actor_username, request_id, action, target_type, target_id,
      request_hash, policy_version, reason, outcome, before_state, after_state, receipt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id`,
    args: [
      params.actorUserId,
      params.actorUsername,
      requestId,
      params.action,
      params.targetType,
      targetId,
      requestHash,
      policyVersion,
      params.reason?.trim() || null,
      params.outcome,
      beforeState === null ? null : canonicalJson(beforeState),
      afterState === null ? null : canonicalJson(afterState),
      canonicalJson(params.receipt),
    ],
  })
  const id = Number(result.rows[0]?.id)
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Admin action receipt insert returned an invalid id')
  }
  return id
}

export async function getBuilderModerationRevision(
  hiveUsername: string
): Promise<number> {
  const result = await execute({
    sql: `SELECT COALESCE(MAX(id), 0) AS revision
      FROM AdminActionLog
      WHERE target_type = ? AND target_id = ? AND outcome = 'applied'
        AND action IN (?, ?)`,
    args: [
      'builder',
      hiveUsername,
      Permission.BLOCK_BUILDER,
      Permission.REACTIVATE_BUILDER,
    ],
  })
  const revision = Number(result.rows[0]?.revision ?? 0)
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('Builder moderation revision is invalid')
  }
  return revision
}
