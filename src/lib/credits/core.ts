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
          hive_username, pending_amount, available_amount, total_issued, total_consumed, revision
        ) VALUES (?, ?, 0, ?, 0, 1)
        ON CONFLICT(hive_username) DO UPDATE SET
          pending_amount = pending_amount + excluded.pending_amount,
          total_issued = total_issued + excluded.total_issued,
          revision = Credits.revision + 1,
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
          hive_username, pending_amount, available_amount, total_issued, total_consumed, revision
        ) VALUES (?, 0, ?, ?, 0, 1)
        ON CONFLICT(hive_username) DO UPDATE SET
          available_amount = available_amount + excluded.available_amount,
          total_issued = total_issued + excluded.total_issued,
          revision = Credits.revision + 1,
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
					revision = revision + 1,
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
  ticketCode: string,
  externalReference?: string
): Promise<void> {
  assertPositiveInteger(amount)
  if (
    externalReference !== undefined &&
    externalReference.trim().length === 0
  ) {
    throw new Error('Ticket purchase requires an operation reference')
  }
  await withTransaction(async () => {
    const result = await execute({
      sql: `
				UPDATE Credits
				SET
					available_amount = available_amount - ?,
					revision = revision + 1,
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
      externalReference,
    })
  })
}

export async function markCreditsAsConsumed(
  hiveUsername: string,
  amount: number,
  accountUsername: string,
  externalReference: string
): Promise<void> {
  assertPositiveInteger(amount)
  if (externalReference.trim().length === 0) {
    throw new Error('Credit consumption requires an operation reference')
  }
  await withTransaction(async () => {
    const result = await execute({
      sql: `
        UPDATE Credits
        SET
          total_consumed = total_consumed + ?,
          revision = revision + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE hive_username = ?
        RETURNING hive_username
      `,
      args: [amount, hiveUsername],
    })
    if (result.rows.length !== 1) {
      throw new Error(
        `Cannot consume account credit without Credits row: ${hiveUsername}`
      )
    }

    await insertCreditAudit({
      hiveUsername,
      operation: 'consume_credits',
      amount: -amount,
      reason: `account created: ${accountUsername}`,
      externalReference,
    })
  })
}

export async function refundCreditsFromTicket(
  hiveUsername: string,
  amount: number,
  ticketCode: string,
  externalReference: string
): Promise<void> {
  assertPositiveInteger(amount)
  if (externalReference.trim().length === 0) {
    throw new Error('Ticket refund requires an operation reference')
  }
  await withTransaction(async () => {
    const result = await execute({
      sql: `
        UPDATE Credits
        SET
          available_amount = available_amount + ?,
          revision = revision + 1,
          updated_at = CURRENT_TIMESTAMP
        WHERE hive_username = ?
        RETURNING hive_username
      `,
      args: [amount, hiveUsername],
    })
    if (result.rows.length !== 1) {
      throw new Error(
        `Cannot refund ticket uses without Credits row: ${hiveUsername}`
      )
    }

    await insertCreditAudit({
      hiveUsername,
      operation: 'delete_ticket_refund',
      amount,
      reason: `ticket deleted: ${ticketCode}`,
      externalReference,
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
      sql: `SELECT pending_amount, available_amount, total_issued, total_consumed, revision
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
        total_issued: Number(row.total_issued),
        total_consumed: Number(row.total_consumed),
        revision: Number(row.revision),
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
    updates.push('revision = revision + 1')
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
      total_issued: Number(row.total_issued),
      total_consumed: Number(row.total_consumed),
      revision: Number(row.revision) + 1,
    }
  })
}
