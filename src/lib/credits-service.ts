/**
 * CREDITS SERVICE - Simplified
 *
 * Simplified credits system with 1 row per builder
 * Columns: pending_amount, available_amount, total_assigned, total_consumed
 */

import { db } from './database'
import { creditBalanceTracker } from './credit-balance-tracker'
import { notifyPendingCredits } from './notification-service'
import { logger } from '@/lib/logger'

/** Partial row from SELECT id */
interface UserIdRow {
  readonly id: number
}

/**
 * Complete credits information for a builder
 */
export interface BuilderCreditsInfo {
  builder_id: number
  hive_username: string
  pending_amount: number // Assigned but not claimed
  available_amount: number // Claimed and available to create tickets
  total_assigned: number // Total historically assigned
  total_consumed: number // Total historically consumed
}

/**
 * Operation to assign credits
 */
export interface AssignCreditsOperation {
  hive_username: string
  amount: number
  source: string
  assigned_by_admin: number
}

class CreditsService {
  /**
   * Get or create credits row for a builder
   * If it doesn't exist, create it automatically
   */
  private async getOrCreateCreditRow(builder_id: number): Promise<void> {
    const existing = await db.execute({
      sql: 'SELECT id FROM Credits WHERE builder_id = ?',
      args: [builder_id],
    })

    if (existing.rows.length === 0) {
      await db.execute({
        sql: `
					INSERT INTO Credits (builder_id, pending_amount, available_amount, total_assigned, total_consumed)
					VALUES (?, 0, 0, 0, 0)
				`,
        args: [builder_id],
      })
    }
  }

  /**
   * 1. Assign credits to a builder (admin → builder)
   * Increments: pending_amount, total_assigned
   * Creates the builder automatically if it doesn't exist
   */
  async assignCredits(
    operation: AssignCreditsOperation
  ): Promise<BuilderCreditsInfo> {
    try {
      // Find or create builder
      let builderResult = await db.execute({
        sql: "SELECT id FROM Users WHERE role = 'builder' AND username = ?",
        args: [operation.hive_username],
      })

      let builder_id: number

      if (builderResult.rows.length === 0) {
        // Create builder automatically
        const createResult = await db.execute({
          sql: 'INSERT INTO Users (username, role, is_active, password_hash) VALUES (?, ?, ?, ?)',
          args: [operation.hive_username, 'builder', true, null],
        })
        builder_id = Number(createResult.lastInsertRowid)
      } else {
        builder_id = (builderResult.rows[0] as unknown as UserIdRow).id
      }

      // Ensure credits row exists
      await this.getOrCreateCreditRow(builder_id)

      // Increment pending_amount and total_assigned
      await db.execute({
        sql: `
					UPDATE Credits
					SET
						pending_amount = pending_amount + ?,
						total_assigned = total_assigned + ?,
						updated_at = CURRENT_TIMESTAMP
					WHERE builder_id = ?
				`,
        args: [operation.amount, operation.amount, builder_id],
      })

      // Create audit entry
      await db.execute({
        sql: `
					INSERT INTO CreditAudit (
						builder_id, operation, amount, reason, performed_by, timestamp
					) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
				`,
        args: [
          builder_id,
          'assign_credits',
          operation.amount,
          `assigned: ${operation.source}`,
          operation.assigned_by_admin,
        ],
      })

      // Create pending credits notification
      try {
        await notifyPendingCredits(builder_id, operation.amount)
      } catch (notificationError) {
        // Do not fail if notification fails, just log
        logger.error('Failed to create notification:', notificationError)
      }

      // Return updated info
      const credits = await creditBalanceTracker.getBalanceById(builder_id)
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
    } catch (error) {
      throw error
    }
  }

  /**
   * 2. Claim credits (pending → available)
   * Decrements: pending_amount
   * Increments: available_amount
   *
   * SECURITY: Atomic operation to prevent race conditions.
   */
  async claimCredits(builder_id: number, amount: number): Promise<void> {
    // Atomic operation: only updates if there are enough pending credits
    const result = await db.execute({
      sql: `
        UPDATE Credits
        SET
          pending_amount = pending_amount - ?,
          available_amount = available_amount + ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE builder_id = ? AND pending_amount >= ?
      `,
      args: [amount, amount, builder_id, amount],
    })

    // If no row was updated, there were not enough pending credits
    if (result.rowsAffected === 0) {
      throw new Error('Insufficient pending credits')
    }

    // Audit (only if the claim was successful)
    await db.execute({
      sql: `
        INSERT INTO CreditAudit (
          builder_id, operation, amount, reason, timestamp
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      args: [builder_id, 'claim_credits', amount, 'claimed by builder'],
    })
  }

  /**
   * 3. Deduct credits when creating ticket
   * Decrements: available_amount
   *
   * SECURITY: Atomic operation to prevent race conditions.
   * The UPDATE only affects rows where available_amount >= amount,
   * guaranteeing that no more credits can be spent than available
   * even with concurrent requests.
   */
  async deductCreditsForTicket(
    builder_id: number,
    amount: number,
    ticket_code: string
  ): Promise<void> {
    // Atomic operation: only updates if there are enough credits
    // The WHERE available_amount >= ? prevents race conditions
    const result = await db.execute({
      sql: `
        UPDATE Credits
        SET
          available_amount = available_amount - ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE builder_id = ? AND available_amount >= ?
      `,
      args: [amount, builder_id, amount],
    })

    // If no row was updated, there were not enough credits
    if (result.rowsAffected === 0) {
      throw new Error('Insufficient credits')
    }

    // Audit (only if the deduction was successful)
    await db.execute({
      sql: `
        INSERT INTO CreditAudit (
          builder_id, operation, amount, reason, timestamp
        ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
      args: [
        builder_id,
        'create_ticket',
        -amount,
        `ticket created: ${ticket_code}`,
      ],
    })
  }

  /**
   * 4. Mark credits as consumed when creating account
   * Increments: total_consumed
   * Note: The credits were ALREADY deducted when creating the ticket
   */
  async markCreditsAsConsumed(
    builder_id: number,
    amount: number,
    account_username: string
  ): Promise<void> {
    try {
      // Increment total_consumed counter
      await db.execute({
        sql: `
					UPDATE Credits
					SET
						total_consumed = total_consumed + ?,
						updated_at = CURRENT_TIMESTAMP
					WHERE builder_id = ?
				`,
        args: [amount, builder_id],
      })

      // Audit
      await db.execute({
        sql: `
					INSERT INTO CreditAudit (
						builder_id, operation, amount, reason, timestamp
					) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
				`,
        args: [
          builder_id,
          'consume_credits',
          -amount,
          `account created: ${account_username}`,
        ],
      })
    } catch (error) {
      throw error
    }
  }

  /**
   * 5. Refund credits when deleting ticket
   * Increments: available_amount
   */
  async refundCreditsFromTicket(
    builder_id: number,
    amount: number,
    ticket_code: string
  ): Promise<void> {
    try {
      // Increment available_amount
      await db.execute({
        sql: `
					UPDATE Credits
					SET
						available_amount = available_amount + ?,
						updated_at = CURRENT_TIMESTAMP
					WHERE builder_id = ?
				`,
        args: [amount, builder_id],
      })

      // Audit
      await db.execute({
        sql: `
					INSERT INTO CreditAudit (
						builder_id, operation, amount, reason, timestamp
					) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
				`,
        args: [
          builder_id,
          'delete_ticket_refund',
          amount,
          `ticket deleted: ${ticket_code}`,
        ],
      })
    } catch (error) {
      throw error
    }
  }

  /**
   * Get credit audit history for a builder
   */
  async getCreditAuditHistory(builder_id: number) {
    const result = await db.execute({
      sql: `
				SELECT id, builder_id, operation, amount, reason, performed_by, timestamp FROM CreditAudit
				WHERE builder_id = ?
				ORDER BY timestamp DESC
			`,
      args: [builder_id],
    })

    return result.rows
  }

  /**
   * Transfer credits between builders
   *
   * SECURITY: Atomic operation to prevent race conditions.
   * The sender's UPDATE uses WHERE available_amount >= amount
   * to guarantee that no more credits can be transferred than available,
   * even with concurrent requests.
   */
  async transferCredits(
    from_builder_id: number,
    to_builder_id: number,
    amount: number
  ): Promise<void> {
    // Basic validation
    if (from_builder_id === to_builder_id) {
      throw new Error('Cannot transfer credits to self')
    }

    if (amount <= 0) {
      throw new Error('The amount must be greater than 0')
    }

    // Verify that the destination builder exists
    const toBuilderResult = await db.execute({
      sql: "SELECT id FROM Users WHERE role = 'builder' AND id = ?",
      args: [to_builder_id],
    })

    if (toBuilderResult.rows.length === 0) {
      throw new Error('Destination builder not found')
    }

    // Ensure both builders have a credits row
    await this.getOrCreateCreditRow(from_builder_id)
    await this.getOrCreateCreditRow(to_builder_id)

    await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

    try {
      // Atomic operation: deduct from sender ONLY if they have enough credits
      // The WHERE available_amount >= ? prevents race conditions
      const deductResult = await db.execute({
        sql: `
          UPDATE Credits
          SET available_amount = available_amount - ?, updated_at = CURRENT_TIMESTAMP
          WHERE builder_id = ? AND available_amount >= ?
        `,
        args: [amount, from_builder_id, amount],
      })

      // If no row was updated, there were not enough credits
      if (deductResult.rowsAffected === 0) {
        throw new Error('Insufficient available credits for transfer')
      }

      // Add to destination (safe because we already validated the source)
      await db.execute({
        sql: `
          UPDATE Credits
          SET available_amount = available_amount + ?, updated_at = CURRENT_TIMESTAMP
          WHERE builder_id = ?
        `,
        args: [amount, to_builder_id],
      })

      // Audit for sender
      await db.execute({
        sql: `
          INSERT INTO CreditAudit (
            builder_id, operation, amount, reason, timestamp
          ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
        args: [
          from_builder_id,
          'transfer_out',
          -amount,
          `transferred to builder ${to_builder_id}`,
        ],
      })

      // Audit for destination
      await db.execute({
        sql: `
          INSERT INTO CreditAudit (
            builder_id, operation, amount, reason, timestamp
          ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
        args: [
          to_builder_id,
          'transfer_in',
          amount,
          `received from builder ${from_builder_id}`,
        ],
      })

      await db.execute({ sql: 'COMMIT', args: [] })
    } catch (error) {
      await db.execute({ sql: 'ROLLBACK', args: [] })
      throw error
    }
  }

  /**
   * 6. Direct credit adjustment by admin (set absolute values)
   * Allows setting pending_amount and/or available_amount directly
   * Only for use by administrators in case of corrections
   */
  async adjustCredits(params: {
    readonly builder_id: number
    readonly pending_amount?: number
    readonly available_amount?: number
    readonly reason: string
    readonly performed_by_admin: number
  }): Promise<BuilderCreditsInfo> {
    const {
      builder_id,
      pending_amount,
      available_amount,
      reason,
      performed_by_admin,
    } = params

    // Get current values
    const currentCredits = await creditBalanceTracker.getBalanceById(builder_id)
    if (!currentCredits) {
      throw new Error('Builder not found')
    }

    // Calculate differences for audit
    const pendingDiff =
      pending_amount !== undefined
        ? pending_amount - currentCredits.pending_amount
        : 0
    const availableDiff =
      available_amount !== undefined
        ? available_amount - currentCredits.available_amount
        : 0

    // Only update if there are changes
    if (pendingDiff === 0 && availableDiff === 0) {
      return currentCredits
    }

    await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

    try {
      // Build dynamic UPDATE
      const updates: string[] = []
      const args: (number | string)[] = []

      if (pending_amount !== undefined) {
        updates.push('pending_amount = ?')
        args.push(pending_amount)
      }
      if (available_amount !== undefined) {
        updates.push('available_amount = ?')
        args.push(available_amount)
      }
      updates.push('updated_at = CURRENT_TIMESTAMP')
      args.push(builder_id)

      await db.execute({
        sql: `UPDATE Credits SET ${updates.join(', ')} WHERE builder_id = ?`,
        args,
      })

      // Log audit with adjustment details
      // NOTE: amount = availableDiff because the breakdown calculates available_amount from audit
      const auditReason = `Admin adjustment: ${reason} | pending: ${currentCredits.pending_amount} → ${pending_amount ?? currentCredits.pending_amount} | available: ${currentCredits.available_amount} → ${available_amount ?? currentCredits.available_amount}`

      await db.execute({
        sql: `
          INSERT INTO CreditAudit (
            builder_id, operation, amount, reason, performed_by, timestamp
          ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
        args: [
          builder_id,
          'admin_adjustment',
          availableDiff,
          auditReason,
          performed_by_admin,
        ],
      })

      await db.execute({ sql: 'COMMIT', args: [] })
    } catch (error) {
      await db.execute({ sql: 'ROLLBACK', args: [] })
      throw error
    }

    // Return updated information
    const updatedCredits = await creditBalanceTracker.getBalanceById(builder_id)
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

  /**
   * Get credit history for a builder
   * @param builderId - Builder ID
   * @returns Array of credit operations sorted by timestamp DESC
   */
  async getCreditHistory(builderId: number): Promise<
    Array<{
      readonly id: number
      readonly operation: string
      readonly amount: number
      readonly reason: string | null
      readonly timestamp: string
      readonly performed_by: number | null
    }>
  > {
    try {
      const result = await db.execute({
        sql: `
					SELECT
						id, operation, amount, reason, timestamp, performed_by
					FROM CreditAudit
					WHERE builder_id = ?
					ORDER BY timestamp DESC
				`,
        args: [builderId],
      })

      return result.rows.map((row: Record<string, unknown>) => ({
        id: Number(row.id),
        operation: String(row.operation),
        amount: Number(row.amount),
        reason: row.reason as string | null,
        timestamp: String(row.timestamp),
        performed_by: row.performed_by as number | null,
      }))
    } catch (error) {
      return []
    }
  }
}

// Singleton instance
export const creditsService = new CreditsService()
