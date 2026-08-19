/**
 * Admin credit management operations.
 *
 * Operations restricted to administrators:
 * assign credits, transfer between builders, direct adjustments.
 */

import { db, insertAppUser } from '../database'
import { UserRole } from '@/lib/roles'
import { creditBalanceTracker } from '../credit-balance-tracker'
import { notifyPendingCredits } from '../notification-service'
import { logger } from '@/lib/logger'
import { getOrCreateCreditRow, insertCreditAudit } from './shared'
import type { BuilderCreditsInfo, AssignCreditsOperation, UserIdRow } from './types'

/**
 * Assign credits to a builder (admin → builder).
 * Creates the builder automatically if not found in the database.
 */
export async function assignCredits(
	operation: AssignCreditsOperation
): Promise<BuilderCreditsInfo> {
	let builderResult = await db.execute({
		sql: `SELECT id FROM "user" WHERE role = 'builder' AND username = ?`,
		args: [operation.hive_username],
	})

	let builderId: string

	if (builderResult.rows.length === 0) {
		builderId = await insertAppUser({
			username: operation.hive_username,
			role: UserRole.Builder,
			authMethod: 'keychain',
			isActive: true,
		})
	} else {
		builderId = String((builderResult.rows[0] as unknown as UserIdRow).id)
	}

	await getOrCreateCreditRow(builderId)

	await db.execute({
		sql: `
			UPDATE Credits
			SET
				pending_amount = pending_amount + ?,
				total_assigned = total_assigned + ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE builder_id = ?
		`,
		args: [operation.amount, operation.amount, builderId],
	})

	await insertCreditAudit({
		builderId,
		operation: 'assign_credits',
		amount: operation.amount,
		reason: `assigned: ${operation.source}`,
		performedBy: operation.assigned_by_admin,
	})

	try {
		await notifyPendingCredits(builderId, operation.amount)
	} catch (notificationError) {
		logger.error('Failed to create notification:', notificationError)
	}

	const credits = await creditBalanceTracker.getBalanceById(builderId)
	if (!credits) {
		throw new Error('Failed to retrieve updated credits')
	}

	return {
		builder_id: credits.builder_id,
		hive_username: credits.hive_username,
		pending_amount: credits.pending_amount,
		available_amount: credits.available_amount,
		total_assigned: credits.total_assigned,
		total_consumed: credits.total_consumed,
	}
}

/**
 * Transfer credits between builders.
 * Atomic transaction to prevent race conditions.
 */
export async function transferCredits(
	fromBuilderId: string,
	toBuilderId: string,
	amount: number
): Promise<void> {
	if (fromBuilderId === toBuilderId) {
		throw new Error('Cannot transfer credits to self')
	}

	if (amount <= 0) {
		throw new Error('The amount must be greater than 0')
	}

	const toBuilderResult = await db.execute({
		sql: `SELECT id FROM "user" WHERE role = 'builder' AND id = ?`,
		args: [toBuilderId],
	})

	if (toBuilderResult.rows.length === 0) {
		throw new Error('Destination builder not found')
	}

	await getOrCreateCreditRow(fromBuilderId)
	await getOrCreateCreditRow(toBuilderId)

	await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

	try {
		const deductResult = await db.execute({
			sql: `
				UPDATE Credits
				SET available_amount = available_amount - ?, updated_at = CURRENT_TIMESTAMP
				WHERE builder_id = ? AND available_amount >= ?
			`,
			args: [amount, fromBuilderId, amount],
		})

		if (deductResult.rowsAffected === 0) {
			throw new Error('Insufficient available credits for transfer')
		}

		await db.execute({
			sql: `
				UPDATE Credits
				SET available_amount = available_amount + ?, updated_at = CURRENT_TIMESTAMP
				WHERE builder_id = ?
			`,
			args: [amount, toBuilderId],
		})

		await insertCreditAudit({
			builderId: fromBuilderId,
			operation: 'transfer_out',
			amount: -amount,
			reason: `transferred to builder ${toBuilderId}`,
		})

		await insertCreditAudit({
			builderId: toBuilderId,
			operation: 'transfer_in',
			amount,
			reason: `received from builder ${fromBuilderId}`,
		})

		await db.execute({ sql: 'COMMIT', args: [] })
	} catch (error) {
		await db.execute({ sql: 'ROLLBACK', args: [] })
		throw error
	}
}

/**
 * Direct credit adjustment by admin (set absolute values).
 * Only for use by administrators in case of corrections.
 */
export async function adjustCredits(params: {
	readonly builder_id: string
	readonly pending_amount?: number
	readonly available_amount?: number
	readonly reason: string
	readonly performed_by_admin: string
}): Promise<BuilderCreditsInfo> {
	const {
		builder_id: builderId,
		pending_amount: pendingAmount,
		available_amount: availableAmount,
		reason,
		performed_by_admin: performedByAdmin,
	} = params

	const currentCredits = await creditBalanceTracker.getBalanceById(builderId)
	if (!currentCredits) {
		throw new Error('Builder not found')
	}

	const pendingDiff =
		pendingAmount !== undefined
			? pendingAmount - currentCredits.pending_amount
			: 0
	const availableDiff =
		availableAmount !== undefined
			? availableAmount - currentCredits.available_amount
			: 0

	if (pendingDiff === 0 && availableDiff === 0) {
		return currentCredits
	}

	await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

	try {
		const updates: string[] = []
		const args: (number | string)[] = []

		if (pendingAmount !== undefined) {
			updates.push('pending_amount = ?')
			args.push(pendingAmount)
		}
		if (availableAmount !== undefined) {
			updates.push('available_amount = ?')
			args.push(availableAmount)
		}
		updates.push('updated_at = CURRENT_TIMESTAMP')
		args.push(builderId)

		await db.execute({
			sql: `UPDATE Credits SET ${updates.join(', ')} WHERE builder_id = ?`,
			args,
		})

		const auditReason = `Admin adjustment: ${reason} | pending: ${currentCredits.pending_amount} → ${pendingAmount ?? currentCredits.pending_amount} | available: ${currentCredits.available_amount} → ${availableAmount ?? currentCredits.available_amount}`

		await insertCreditAudit({
			builderId,
			operation: 'admin_adjustment',
			amount: availableDiff,
			reason: auditReason,
			performedBy: performedByAdmin,
		})

		await db.execute({ sql: 'COMMIT', args: [] })
	} catch (error) {
		await db.execute({ sql: 'ROLLBACK', args: [] })
		throw error
	}

	const updatedCredits = await creditBalanceTracker.getBalanceById(builderId)
	if (!updatedCredits) {
		throw new Error('Error obtaining updated credits')
	}

	return {
		builder_id: updatedCredits.builder_id,
		hive_username: updatedCredits.hive_username,
		pending_amount: updatedCredits.pending_amount,
		available_amount: updatedCredits.available_amount,
		total_assigned: updatedCredits.total_assigned,
		total_consumed: updatedCredits.total_consumed,
	}
}
