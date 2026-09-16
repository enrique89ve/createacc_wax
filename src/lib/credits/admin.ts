import { db, withTransaction } from '../database'
import { notifyPendingCredits } from '../notification-service'
import { logger } from '@/lib/logger'
import { insertCreditAudit, selectCreditRow } from './shared'
import {
  ZERO_BALANCE,
  type AssignCreditsOperation,
  type CreditBalance,
} from './types'

export async function assignCredits(
  operation: AssignCreditsOperation
): Promise<CreditBalance> {
  await withTransaction(async () => {
    await db.execute({
      sql: `
				INSERT INTO Credits (
					hive_username, pending_amount, available_amount, total_assigned, total_consumed
				) VALUES (?, ?, 0, ?, 0)
				ON CONFLICT(hive_username) DO UPDATE SET
					pending_amount = pending_amount + excluded.pending_amount,
					total_assigned = total_assigned + excluded.total_assigned,
					updated_at = CURRENT_TIMESTAMP
			`,
      args: [operation.hive_username, operation.amount, operation.amount],
    })

    await insertCreditAudit({
      hiveUsername: operation.hive_username,
      operation: 'assign_credits',
      amount: operation.amount,
      reason: `assigned: ${operation.source}`,
      performedBy: operation.assigned_by_admin,
    })
  })

  try {
    await notifyPendingCredits(operation.hive_username, operation.amount)
  } catch (notificationError) {
    logger.error('Failed to create notification:', notificationError)
  }

  const credits = await selectCreditRow(operation.hive_username)
  if (!credits) {
    throw new Error('Failed to retrieve updated credits')
  }

  return {
    hive_username: operation.hive_username,
    ...credits,
  }
}

export async function transferCredits(
  fromUsername: string,
  toUsername: string,
  amount: number
): Promise<void> {
  if (fromUsername === toUsername) {
    throw new Error('Cannot transfer credits to self')
  }

  if (amount <= 0) {
    throw new Error('The amount must be greater than 0')
  }

  await withTransaction(async () => {
    const deductResult = await db.execute({
      sql: `
				UPDATE Credits
				SET available_amount = available_amount - ?, updated_at = CURRENT_TIMESTAMP
				WHERE hive_username = ? AND available_amount >= ?
			`,
      args: [amount, fromUsername, amount],
    })

    if (deductResult.rowsAffected === 0) {
      throw new Error('Insufficient available credits for transfer')
    }

    await db.execute({
      sql: `
				INSERT INTO Credits (
					hive_username, pending_amount, available_amount, total_assigned, total_consumed
				) VALUES (?, 0, ?, 0, 0)
				ON CONFLICT(hive_username) DO UPDATE SET
					available_amount = available_amount + excluded.available_amount,
					updated_at = CURRENT_TIMESTAMP
			`,
      args: [toUsername, amount],
    })

    await insertCreditAudit({
      hiveUsername: fromUsername,
      operation: 'transfer_out',
      amount: -amount,
      reason: `transferred to ${toUsername}`,
    })

    await insertCreditAudit({
      hiveUsername: toUsername,
      operation: 'transfer_in',
      amount,
      reason: `received from ${fromUsername}`,
    })
  })
}

export async function adjustCredits(params: {
  readonly hive_username: string
  readonly pending_amount?: number
  readonly available_amount?: number
  readonly reason: string
  readonly performed_by_admin: string
}): Promise<CreditBalance> {
  const current = await selectCreditRow(params.hive_username)
  if (!current) {
    return ZERO_BALANCE(params.hive_username)
  }

  const pendingDiff =
    params.pending_amount !== undefined
      ? params.pending_amount - current.pending_amount
      : 0
  const availableDiff =
    params.available_amount !== undefined
      ? params.available_amount - current.available_amount
      : 0

  if (pendingDiff === 0 && availableDiff === 0) {
    return {
      hive_username: params.hive_username,
      ...current,
    }
  }

  await withTransaction(async () => {
    const updates: string[] = []
    const args: (number | string)[] = []

    if (params.pending_amount !== undefined) {
      updates.push('pending_amount = ?')
      args.push(params.pending_amount)
    }
    if (params.available_amount !== undefined) {
      updates.push('available_amount = ?')
      args.push(params.available_amount)
    }
    updates.push('updated_at = CURRENT_TIMESTAMP')
    args.push(params.hive_username)

    await db.execute({
      sql: `UPDATE Credits SET ${updates.join(', ')} WHERE hive_username = ?`,
      args,
    })

    await insertCreditAudit({
      hiveUsername: params.hive_username,
      operation: 'admin_adjustment',
      amount: availableDiff,
      reason: `Admin adjustment: ${params.reason}`,
      performedBy: params.performed_by_admin,
    })
  })

  const updated = await selectCreditRow(params.hive_username)
  if (!updated) {
    throw new Error('Error obtaining updated credits')
  }

  return {
    hive_username: params.hive_username,
    ...updated,
  }
}
