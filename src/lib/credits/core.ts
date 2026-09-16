import { db } from '../database'
import { insertCreditAudit } from './shared'

export async function claimCredits(
  hiveUsername: string,
  amount: number
): Promise<void> {
  const result = await db.execute({
    sql: `
			UPDATE Credits
			SET
				pending_amount = pending_amount - ?,
				available_amount = available_amount + ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE hive_username = ? AND pending_amount >= ?
		`,
    args: [amount, amount, hiveUsername, amount],
  })

  if (result.rowsAffected === 0) {
    throw new Error('Insufficient pending credits')
  }

  await insertCreditAudit({
    hiveUsername,
    operation: 'claim_credits',
    amount,
    reason: 'claimed by builder',
  })
}

export async function deductCreditsForTicket(
  hiveUsername: string,
  amount: number,
  ticketCode: string
): Promise<void> {
  const result = await db.execute({
    sql: `
			UPDATE Credits
			SET
				available_amount = available_amount - ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE hive_username = ? AND available_amount >= ?
		`,
    args: [amount, hiveUsername, amount],
  })

  if (result.rowsAffected === 0) {
    throw new Error('Insufficient credits')
  }

  await insertCreditAudit({
    hiveUsername,
    operation: 'create_ticket',
    amount: -amount,
    reason: `ticket created: ${ticketCode}`,
  })
}

export async function markCreditsAsConsumed(
  hiveUsername: string,
  amount: number,
  accountUsername: string
): Promise<void> {
  await db.execute({
    sql: `
			UPDATE Credits
			SET
				total_consumed = total_consumed + ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE hive_username = ?
		`,
    args: [amount, hiveUsername],
  })

  await insertCreditAudit({
    hiveUsername,
    operation: 'consume_credits',
    amount: -amount,
    reason: `account created: ${accountUsername}`,
  })
}

export async function refundCreditsFromTicket(
  hiveUsername: string,
  amount: number,
  ticketCode: string
): Promise<void> {
  await db.execute({
    sql: `
			UPDATE Credits
			SET
				available_amount = available_amount + ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE hive_username = ?
		`,
    args: [amount, hiveUsername],
  })

  await insertCreditAudit({
    hiveUsername,
    operation: 'delete_ticket_refund',
    amount,
    reason: `ticket deleted: ${ticketCode}`,
  })
}
