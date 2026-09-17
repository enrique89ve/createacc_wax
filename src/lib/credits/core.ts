import { execute, withTransaction } from '../database'
import { insertCreditAudit } from './shared'
import { ZERO_BALANCE, type CreditBalance } from './types'

function assertPositiveInteger(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('Credit amount must be a positive safe integer')
  }
}

function assertNonNegativeInteger(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error('Credit amount must be a non-negative safe integer')
  }
}

export async function grantPendingCredits(params: {
  readonly hiveUsername: string
  readonly amount: number
  readonly reason: string
  readonly performedBy?: string
}): Promise<void> {
  assertPositiveInteger(params.amount)
  await withTransaction(async () => {
    await execute({
      sql: `
        INSERT INTO Credits (
          hive_username, pending_amount, available_amount, total_assigned, total_consumed
        ) VALUES (?, ?, 0, ?, 0)
        ON CONFLICT(hive_username) DO UPDATE SET
          pending_amount = pending_amount + excluded.pending_amount,
          total_assigned = total_assigned + excluded.total_assigned,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [params.hiveUsername, params.amount, params.amount],
    })

    await insertCreditAudit({
      hiveUsername: params.hiveUsername,
      operation: 'assign_credits',
      amount: params.amount,
      reason: params.reason,
      performedBy: params.performedBy,
    })
  })
}

export async function grantAvailableCredits(params: {
  readonly hiveUsername: string
  readonly amount: number
  readonly reason: string
  readonly performedBy?: string
  readonly externalReference?: string
}): Promise<void> {
  assertPositiveInteger(params.amount)
  await withTransaction(async () => {
    await execute({
      sql: `
        INSERT INTO Credits (
          hive_username, pending_amount, available_amount, total_assigned, total_consumed
        ) VALUES (?, 0, ?, ?, 0)
        ON CONFLICT(hive_username) DO UPDATE SET
          available_amount = available_amount + excluded.available_amount,
          total_assigned = total_assigned + excluded.total_assigned,
          updated_at = CURRENT_TIMESTAMP
      `,
      args: [params.hiveUsername, params.amount, params.amount],
    })

    await insertCreditAudit({
      hiveUsername: params.hiveUsername,
      operation: 'grant_available_credits',
      amount: params.amount,
      reason: params.reason,
      performedBy: params.performedBy,
      externalReference: params.externalReference,
    })
  })
}

export async function claimCredits(
  hiveUsername: string,
  amount: number,
  auditContext: { readonly externalReference?: string } = {}
): Promise<void> {
  assertPositiveInteger(amount)
  await withTransaction(async () => {
    const result = await execute({
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
      externalReference: auditContext.externalReference,
    })
  })
}

export async function deductCreditsForTicket(
  hiveUsername: string,
  amount: number,
  ticketCode: string
): Promise<void> {
  assertPositiveInteger(amount)
  await withTransaction(async () => {
    const result = await execute({
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
  })
}

export async function markCreditsAsConsumed(
  hiveUsername: string,
  amount: number,
  accountUsername: string
): Promise<void> {
  assertPositiveInteger(amount)
  await withTransaction(async () => {
    await execute({
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
  })
}

export async function refundCreditsFromTicket(
  hiveUsername: string,
  amount: number,
  ticketCode: string
): Promise<void> {
  assertPositiveInteger(amount)
  await withTransaction(async () => {
    await execute({
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
  })
}

export async function adjustCreditBalances(params: {
  readonly hiveUsername: string
  readonly pendingAmount?: number
  readonly availableAmount?: number
  readonly reason: string
  readonly performedBy: string
}): Promise<CreditBalance> {
  if (
    params.pendingAmount === undefined &&
    params.availableAmount === undefined
  ) {
    throw new Error('At least one credit balance must be provided')
  }
  if (params.pendingAmount !== undefined) {
    assertNonNegativeInteger(params.pendingAmount)
  }
  if (params.availableAmount !== undefined) {
    assertNonNegativeInteger(params.availableAmount)
  }

  return withTransaction(async () => {
    const current = await execute({
      sql: `SELECT pending_amount, available_amount, total_assigned, total_consumed
        FROM Credits WHERE hive_username = ?`,
      args: [params.hiveUsername],
    })
    if (current.rows.length === 0) return ZERO_BALANCE(params.hiveUsername)

    const row = current.rows[0] as Record<string, unknown>
    const currentPending = Number(row.pending_amount)
    const currentAvailable = Number(row.available_amount)
    const pendingDiff =
      params.pendingAmount === undefined
        ? 0
        : params.pendingAmount - currentPending
    const availableDiff =
      params.availableAmount === undefined
        ? 0
        : params.availableAmount - currentAvailable

    if (pendingDiff === 0 && availableDiff === 0) {
      return {
        hive_username: params.hiveUsername,
        pending_amount: currentPending,
        available_amount: currentAvailable,
        total_assigned: Number(row.total_assigned),
        total_consumed: Number(row.total_consumed),
      }
    }

    const updates: string[] = []
    const args: (number | string)[] = []
    if (params.pendingAmount !== undefined) {
      updates.push('pending_amount = ?')
      args.push(params.pendingAmount)
    }
    if (params.availableAmount !== undefined) {
      updates.push('available_amount = ?')
      args.push(params.availableAmount)
    }
    updates.push('updated_at = CURRENT_TIMESTAMP')
    args.push(params.hiveUsername)
    await execute({
      sql: `UPDATE Credits SET ${updates.join(', ')} WHERE hive_username = ?`,
      args,
    })

    if (pendingDiff !== 0) {
      await insertCreditAudit({
        hiveUsername: params.hiveUsername,
        operation: 'admin_adjust_pending',
        amount: pendingDiff,
        reason: `Admin adjustment: ${params.reason}`,
        performedBy: params.performedBy,
      })
    }
    if (availableDiff !== 0) {
      await insertCreditAudit({
        hiveUsername: params.hiveUsername,
        operation: 'admin_adjustment',
        amount: availableDiff,
        reason: `Admin adjustment: ${params.reason}`,
        performedBy: params.performedBy,
      })
    }

    return {
      hive_username: params.hiveUsername,
      pending_amount: params.pendingAmount ?? currentPending,
      available_amount: params.availableAmount ?? currentAvailable,
      total_assigned: Number(row.total_assigned),
      total_consumed: Number(row.total_consumed),
    }
  })
}
