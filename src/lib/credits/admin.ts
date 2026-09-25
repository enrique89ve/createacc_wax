import { notifyPendingCredits } from '../notification-service'
import { logger } from '@/lib/logger'
import { selectCreditRow } from './shared'
import { grantPendingCredits } from './core'
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
