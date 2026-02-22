/**
 * Core credit lifecycle operations.
 *
 * Builder-facing operations for the credit system:
 * claim, deduct (ticket creation), consume (account creation), refund (ticket deletion).
 */

import { db } from '../database'
import { insertCreditAudit } from './shared'

/**
 * Claim credits (pending → available).
 * Atomic operation to prevent race conditions.
 */
export async function claimCredits(builderId: number, amount: number): Promise<void> {
	const result = await db.execute({
		sql: `
			UPDATE Credits
			SET
				pending_amount = pending_amount - ?,
				available_amount = available_amount + ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE builder_id = ? AND pending_amount >= ?
		`,
		args: [amount, amount, builderId, amount],
	})

	if (result.rowsAffected === 0) {
		throw new Error('Insufficient pending credits')
	}

	await insertCreditAudit({
		builderId,
		operation: 'claim_credits',
		amount,
		reason: 'claimed by builder',
	})
}

/**
 * Deduct credits when creating a ticket.
 * Atomic: only succeeds if available_amount >= amount.
 */
export async function deductCreditsForTicket(
	builderId: number,
	amount: number,
	ticketCode: string
): Promise<void> {
	const result = await db.execute({
		sql: `
			UPDATE Credits
			SET
				available_amount = available_amount - ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE builder_id = ? AND available_amount >= ?
		`,
		args: [amount, builderId, amount],
	})

	if (result.rowsAffected === 0) {
		throw new Error('Insufficient credits')
	}

	await insertCreditAudit({
		builderId,
		operation: 'create_ticket',
		amount: -amount,
		reason: `ticket created: ${ticketCode}`,
	})
}

/**
 * Mark credits as consumed when an account is created.
 * The credits were already deducted when the ticket was created.
 */
export async function markCreditsAsConsumed(
	builderId: number,
	amount: number,
	accountUsername: string
): Promise<void> {
	await db.execute({
		sql: `
			UPDATE Credits
			SET
				total_consumed = total_consumed + ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE builder_id = ?
		`,
		args: [amount, builderId],
	})

	await insertCreditAudit({
		builderId,
		operation: 'consume_credits',
		amount: -amount,
		reason: `account created: ${accountUsername}`,
	})
}

/**
 * Refund credits when a ticket is deleted.
 */
export async function refundCreditsFromTicket(
	builderId: number,
	amount: number,
	ticketCode: string
): Promise<void> {
	await db.execute({
		sql: `
			UPDATE Credits
			SET
				available_amount = available_amount + ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE builder_id = ?
		`,
		args: [amount, builderId],
	})

	await insertCreditAudit({
		builderId,
		operation: 'delete_ticket_refund',
		amount,
		reason: `ticket deleted: ${ticketCode}`,
	})
}
