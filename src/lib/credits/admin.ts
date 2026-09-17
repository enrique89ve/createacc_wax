import { execute, withTransaction } from '../database'
import { notifyPendingCredits } from '../notification-service'
import { logger } from '@/lib/logger'
import { insertCreditAudit, selectCreditRow } from './shared'
import { adjustCreditBalances, grantPendingCredits } from './core'
import { type AssignCreditsOperation, type CreditBalance } from './types'

export async function assignCredits(
  operation: AssignCreditsOperation
): Promise<CreditBalance> {
  await grantPendingCredits({
    hiveUsername: operation.hive_username,
    amount: operation.amount,
    reason: `assigned: ${operation.source}`,
    performedBy: operation.assigned_by_admin,
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
    const deductResult = await execute({
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

    await execute({
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
  return adjustCreditBalances({
    hiveUsername: params.hive_username,
    pendingAmount: params.pending_amount,
    availableAmount: params.available_amount,
    reason: params.reason,
    performedBy: params.performed_by_admin,
  })
}
