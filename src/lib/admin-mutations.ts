import type { AdminSession } from '@/types/auth'
import { Permission, hasPermission } from './auth/permissions'
import { execute, withTransaction } from './database'
import {
  appendAdminActionReceipt,
  findAdminActionReceipt,
  hashAdminActionCommand,
  type AdminJsonValue,
} from './admin-action-log'
import {
  adjustCreditBalances,
  CreditBalanceRevisionConflictError,
} from './credits/core'
import type { CreditBalance } from './credits/types'
import { UserRole } from './roles'
import { isUsernameFormat } from '@/utils/suspicious-username'

export const ADMIN_MUTATION_ERROR_STATUS = {
  INVALID_COMMAND: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  RESOURCE_NOT_FOUND: 404,
  STALE_CREDIT_REVISION: 409,
  PENDING_CLAIM_ACTIVE: 409,
  IDEMPOTENCY_CONFLICT: 409,
} as const

export type AdminMutationErrorCode = keyof typeof ADMIN_MUTATION_ERROR_STATUS

export class AdminMutationError extends Error {
  readonly status: (typeof ADMIN_MUTATION_ERROR_STATUS)[AdminMutationErrorCode]

  constructor(
    readonly code: AdminMutationErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AdminMutationError'
    this.status = ADMIN_MUTATION_ERROR_STATUS[code]
  }
}

export const ADMIN_CREDIT_BALANCE_LIMIT = 100_000
const ADMIN_REASON_MAX_LENGTH = 500
const ADMIN_REQUEST_ID_MAX_LENGTH = 128

export interface AdminCreditAdjustmentInput {
  readonly hiveUsername: string
  readonly expectedRevision: number
  readonly requestId: string
  readonly reason: string
  readonly pendingAmount?: number
  readonly availableAmount?: number
}

export type ParseAdminCreditAdjustmentResult =
  | { readonly ok: true; readonly input: AdminCreditAdjustmentInput }
  | {
      readonly ok: false
      readonly code: 'INVALID_COMMAND'
      readonly message: string
    }

export interface AdminCreditAdjustmentResult {
  readonly disposition: 'applied' | 'unchanged' | 'replayed'
  readonly actionLogId: number
  readonly credits: CreditBalance
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function invalidCommand(message: string): ParseAdminCreditAdjustmentResult {
  return { ok: false, code: 'INVALID_COMMAND', message }
}

function isValidRequestedBalance(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= ADMIN_CREDIT_BALANCE_LIMIT
  )
}

export function parseAdminCreditAdjustmentInput(
  usernameValue: unknown,
  bodyValue: unknown
): ParseAdminCreditAdjustmentResult {
  if (!isUsernameFormat(usernameValue)) {
    return invalidCommand('Username Hive inválido')
  }
  const hiveUsername = usernameValue.trim().toLowerCase()
  if (!isRecord(bodyValue)) {
    return invalidCommand('El cuerpo debe ser un objeto JSON')
  }

  const allowedKeys = new Set([
    'pending_amount',
    'available_amount',
    'expected_revision',
    'request_id',
    'reason',
  ])
  if (Object.keys(bodyValue).some(key => !allowedKeys.has(key))) {
    return invalidCommand('El cuerpo contiene campos desconocidos')
  }

  const hasPendingAmount = Object.hasOwn(bodyValue, 'pending_amount')
  const hasAvailableAmount = Object.hasOwn(bodyValue, 'available_amount')
  if (!hasPendingAmount && !hasAvailableAmount) {
    return invalidCommand('Debe cambiar al menos un saldo')
  }
  const pendingAmount = bodyValue.pending_amount
  const availableAmount = bodyValue.available_amount
  if (hasPendingAmount && !isValidRequestedBalance(pendingAmount)) {
    return invalidCommand(
      'Créditos pendientes debe ser un entero entre 0 y 100000'
    )
  }
  if (hasAvailableAmount && !isValidRequestedBalance(availableAmount)) {
    return invalidCommand(
      'Créditos disponibles debe ser un entero entre 0 y 100000'
    )
  }

  const expectedRevision = bodyValue.expected_revision
  if (
    typeof expectedRevision !== 'number' ||
    !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    return invalidCommand('La revisión esperada no es válida')
  }

  const requestId = bodyValue.request_id
  if (
    typeof requestId !== 'string' ||
    requestId.trim().length === 0 ||
    requestId.trim().length > ADMIN_REQUEST_ID_MAX_LENGTH
  ) {
    return invalidCommand('El identificador de solicitud no es válido')
  }

  const reason = bodyValue.reason
  if (
    typeof reason !== 'string' ||
    reason.trim().length === 0 ||
    reason.trim().length > ADMIN_REASON_MAX_LENGTH
  ) {
    return invalidCommand(
      'El motivo es obligatorio y debe tener hasta 500 caracteres'
    )
  }

  return {
    ok: true,
    input: {
      hiveUsername,
      expectedRevision,
      requestId: requestId.trim(),
      reason: reason.trim(),
      ...(hasPendingAmount ? { pendingAmount: pendingAmount as number } : {}),
      ...(hasAvailableAmount
        ? { availableAmount: availableAmount as number }
        : {}),
    },
  }
}

function getCreditBalance(row: Record<string, unknown>): CreditBalance {
  const result: CreditBalance = {
    hive_username: String(row.hive_username),
    pending_amount: Number(row.pending_amount),
    available_amount: Number(row.available_amount),
    total_issued: Number(row.total_issued),
    total_consumed: Number(row.total_consumed),
    revision: Number(row.revision),
  }
  if (
    Object.values(result).some(
      value => typeof value === 'number' && !Number.isSafeInteger(value)
    ) ||
    Object.values(result).some(value => typeof value === 'number' && value < 0)
  ) {
    throw new Error('Credits row contains an invalid numeric value')
  }
  return result
}

function parseReceiptBalance(value: AdminJsonValue): CreditBalance {
  if (!isRecord(value) || !isRecord(value.credits)) {
    throw new Error('Stored admin credit receipt has an invalid shape')
  }
  const credits = value.credits
  const fields = [
    'hive_username',
    'pending_amount',
    'available_amount',
    'total_issued',
    'total_consumed',
    'revision',
  ] as const
  if (
    fields.some(field => !Object.hasOwn(credits, field)) ||
    typeof credits.hive_username !== 'string'
  ) {
    throw new Error('Stored admin credit receipt is incomplete')
  }
  const balance = getCreditBalance(credits)
  if (balance.hive_username.length === 0) {
    throw new Error('Stored admin credit receipt has no username')
  }
  return balance
}

function creditBalanceToJson(balance: CreditBalance): AdminJsonValue {
  return {
    hive_username: balance.hive_username,
    pending_amount: balance.pending_amount,
    available_amount: balance.available_amount,
    total_issued: balance.total_issued,
    total_consumed: balance.total_consumed,
    revision: balance.revision,
  }
}

export async function adjustBuilderCredits(
  actorSession: AdminSession,
  input: AdminCreditAdjustmentInput
): Promise<AdminCreditAdjustmentResult> {
  const parsedInput = parseAdminCreditAdjustmentInput(input.hiveUsername, {
    expected_revision: input.expectedRevision,
    request_id: input.requestId,
    reason: input.reason,
    ...(input.pendingAmount === undefined
      ? {}
      : { pending_amount: input.pendingAmount }),
    ...(input.availableAmount === undefined
      ? {}
      : { available_amount: input.availableAmount }),
  })
  if (!parsedInput.ok) {
    throw new AdminMutationError('INVALID_COMMAND', parsedInput.message)
  }
  const command = parsedInput.input

  return withTransaction(async () => {
    const actorResult = await execute({
      sql: `SELECT id, username, role, is_active FROM "user" WHERE id = ? LIMIT 1`,
      args: [actorSession.userId],
    })
    const actorRow = actorResult.rows[0] as Record<string, unknown> | undefined
    if (!actorRow || Number(actorRow.is_active) !== 1) {
      throw new AdminMutationError(
        'UNAUTHENTICATED',
        'La sesión de administrador ya no está activa'
      )
    }
    if (
      actorRow.role !== UserRole.Admin ||
      !hasPermission(UserRole.Admin, Permission.ADJUST_CREDITS)
    ) {
      throw new AdminMutationError(
        'FORBIDDEN',
        'No tiene permiso para ajustar créditos'
      )
    }
    if (typeof actorRow.username !== 'string') {
      throw new Error('Active admin row has no username')
    }

    const requestHash = hashAdminActionCommand({
      action: Permission.ADJUST_CREDITS,
      targetType: 'credits',
      targetId: command.hiveUsername,
      normalizedCommand: {
        expected_revision: command.expectedRevision,
        pending_amount: command.pendingAmount ?? null,
        available_amount: command.availableAmount ?? null,
        reason: command.reason,
      },
    })
    const existingReceipt = await findAdminActionReceipt({
      actorUserId: actorSession.userId,
      requestId: command.requestId,
    })
    if (existingReceipt) {
      if (existingReceipt.request_hash !== requestHash) {
        throw new AdminMutationError(
          'IDEMPOTENCY_CONFLICT',
          'Este identificador ya se usó para otra solicitud'
        )
      }
      return {
        disposition: 'replayed',
        actionLogId: existingReceipt.id,
        credits: parseReceiptBalance(existingReceipt.receipt),
      }
    }

    // Use one server timestamp for claim-intent expiry and the entire decision.
    const now = Date.now()
    const currentResult = await execute({
      sql: `SELECT hive_username, pending_amount, available_amount,
        total_issued, total_consumed, revision
        FROM Credits WHERE hive_username = ? LIMIT 1`,
      args: [command.hiveUsername],
    })
    const currentRow = currentResult.rows[0] as
      | Record<string, unknown>
      | undefined
    if (!currentRow) {
      throw new AdminMutationError(
        'RESOURCE_NOT_FOUND',
        'No existe una cuenta de créditos para ese usuario'
      )
    }
    const current = getCreditBalance(currentRow)
    if (current.revision !== command.expectedRevision) {
      throw new AdminMutationError(
        'STALE_CREDIT_REVISION',
        'El saldo cambió desde que se abrió el formulario'
      )
    }

    const nextPending = command.pendingAmount ?? current.pending_amount
    const pendingWillDecrease = nextPending < current.pending_amount
    if (pendingWillDecrease) {
      const activeIntentResult = await execute({
        sql: `SELECT 1 FROM CreditClaimIntents
          WHERE hive_username = ? AND expires_at > ?
          LIMIT 1`,
        args: [command.hiveUsername, now],
      })
      if (activeIntentResult.rows.length > 0) {
        throw new AdminMutationError(
          'PENDING_CLAIM_ACTIVE',
          'No se pueden reducir créditos pendientes durante una reclamación activa'
        )
      }
    }

    const next: CreditBalance = {
      ...current,
      pending_amount: nextPending,
      available_amount: command.availableAmount ?? current.available_amount,
    }
    const unchanged =
      next.pending_amount === current.pending_amount &&
      next.available_amount === current.available_amount
    let updated = current
    if (!unchanged) {
      try {
        updated = await adjustCreditBalances({
          hiveUsername: command.hiveUsername,
          expectedRevision: current.revision,
          pendingAmount: command.pendingAmount,
          availableAmount: command.availableAmount,
          reason: command.reason,
          performedBy: actorRow.username,
        })
      } catch (error) {
        if (error instanceof CreditBalanceRevisionConflictError) {
          throw new AdminMutationError(
            'STALE_CREDIT_REVISION',
            'El saldo cambió desde que se abrió el formulario'
          )
        }
        throw error
      }
    }
    const outcome = unchanged ? 'unchanged' : 'applied'
    const actionLogId = await appendAdminActionReceipt({
      actorUserId: actorSession.userId,
      actorUsername: actorRow.username,
      requestId: command.requestId,
      action: Permission.ADJUST_CREDITS,
      targetType: 'credits',
      targetId: command.hiveUsername,
      requestHash,
      reason: command.reason,
      outcome,
      beforeState: creditBalanceToJson(current),
      afterState: creditBalanceToJson(updated),
      receipt: { credits: creditBalanceToJson(updated) },
    })
    return { disposition: outcome, actionLogId, credits: updated }
  })
}
