import { execute } from './database'
import { ZERO_BALANCE } from './credits/types'

export interface CreditBalance {
  readonly hive_username: string
  readonly pending_amount: number
  readonly available_amount: number
  readonly total_assigned: number
  readonly total_consumed: number
  readonly is_consistent: boolean
  readonly calculated_at: string
}

export interface CreditBalanceBreakdown extends CreditBalance {
  readonly breakdown: {
    readonly assigned: number
    readonly claimed: number
    readonly spent_on_tickets: number
    readonly refunded_from_tickets: number
    readonly consumed_on_accounts: number
  }
  readonly discrepancy: {
    readonly has_discrepancy: boolean
    readonly expected_available: number
    readonly actual_available: number
    readonly difference: number
  }
}

export interface ConsistencyCheck {
  readonly hive_username: string
  readonly is_consistent: boolean
  readonly critical_issues: string[]
  readonly warning_issues: string[]
  readonly calculated_available: number
  readonly stored_available: number
  readonly difference: number
}

function toBalance(
  hiveUsername: string,
  row: {
    pending_amount: number
    available_amount: number
    total_assigned: number
    total_consumed: number
  },
  isConsistent: boolean
): CreditBalance {
  return {
    hive_username: hiveUsername,
    pending_amount: row.pending_amount,
    available_amount: row.available_amount,
    total_assigned: row.total_assigned,
    total_consumed: row.total_consumed,
    is_consistent: isConsistent,
    calculated_at: new Date().toISOString(),
  }
}

async function calculateBreakdown(hiveUsername: string) {
  const result = await execute({
    sql: `
			SELECT
				COALESCE(SUM(CASE WHEN operation = 'assign_credits' THEN amount ELSE 0 END), 0) as assigned,
				COALESCE(SUM(CASE WHEN operation IN ('claim_credits', 'claim_via_blockchain') THEN amount ELSE 0 END), 0) as claimed,
				COALESCE(SUM(CASE WHEN operation = 'create_ticket' THEN amount ELSE 0 END), 0) as spent_on_tickets,
				COALESCE(SUM(CASE WHEN operation = 'delete_ticket_refund' THEN amount ELSE 0 END), 0) as refunded_from_tickets,
				COALESCE(SUM(CASE WHEN operation = 'consume_credits' THEN amount ELSE 0 END), 0) as consumed_on_accounts,
				COALESCE(SUM(CASE WHEN operation = 'admin_adjustment' THEN amount ELSE 0 END), 0) as admin_adjustments
			FROM CreditAudit
			WHERE hive_username = ?
		`,
    args: [hiveUsername],
  })

  const row = result.rows[0] as Record<string, unknown>
  return {
    assigned: Number(row.assigned || 0),
    claimed: Number(row.claimed || 0),
    spent_on_tickets: Number(row.spent_on_tickets || 0),
    refunded_from_tickets: Number(row.refunded_from_tickets || 0),
    consumed_on_accounts: Number(row.consumed_on_accounts || 0),
    admin_adjustments: Number(row.admin_adjustments || 0),
  }
}

async function getStoredCredits(hiveUsername: string) {
  const result = await execute({
    sql: `
			SELECT pending_amount, available_amount, total_assigned, total_consumed
			FROM Credits
			WHERE hive_username = ?
		`,
    args: [hiveUsername],
  })

  if (result.rows.length === 0) return null

  const row = result.rows[0] as Record<string, unknown>
  return {
    pending_amount: Number(row.pending_amount || 0),
    available_amount: Number(row.available_amount || 0),
    total_assigned: Number(row.total_assigned || 0),
    total_consumed: Number(row.total_consumed || 0),
  }
}

export async function checkConsistency(
  hiveUsername: string
): Promise<ConsistencyCheck> {
  const stored = await getStoredCredits(hiveUsername)
  if (!stored) {
    return {
      hive_username: hiveUsername,
      is_consistent: true,
      critical_issues: [],
      warning_issues: [],
      calculated_available: 0,
      stored_available: 0,
      difference: 0,
    }
  }

  const breakdown = await calculateBreakdown(hiveUsername)
  const calculatedAvailable =
    breakdown.claimed +
    breakdown.spent_on_tickets +
    breakdown.refunded_from_tickets +
    breakdown.admin_adjustments

  const critical_issues: string[] = []
  const warning_issues: string[] = []

  if (calculatedAvailable !== stored.available_amount) {
    critical_issues.push(
      `inconsistent available_amount: expected ${calculatedAvailable}, actual ${stored.available_amount}`
    )
  }

  if (breakdown.assigned !== stored.total_assigned) {
    warning_issues.push(
      `inconsistent total_assigned: expected ${breakdown.assigned}, actual ${stored.total_assigned}`
    )
  }

  return {
    hive_username: hiveUsername,
    is_consistent: critical_issues.length === 0,
    critical_issues,
    warning_issues,
    calculated_available: calculatedAvailable,
    stored_available: stored.available_amount,
    difference: stored.available_amount - calculatedAvailable,
  }
}

export async function getBalance(hiveUsername: string): Promise<CreditBalance> {
  const stored = await getStoredCredits(hiveUsername)
  if (!stored) {
    return {
      ...ZERO_BALANCE(hiveUsername),
      is_consistent: true,
      calculated_at: new Date().toISOString(),
    }
  }

  const consistency = await checkConsistency(hiveUsername)
  return toBalance(hiveUsername, stored, consistency.is_consistent)
}

export async function getDetailedBalance(
  hiveUsername: string
): Promise<CreditBalanceBreakdown> {
  const balance = await getBalance(hiveUsername)
  const breakdown = await calculateBreakdown(hiveUsername)
  const expectedAvailable =
    breakdown.claimed +
    breakdown.spent_on_tickets +
    breakdown.refunded_from_tickets +
    breakdown.admin_adjustments

  return {
    ...balance,
    breakdown,
    discrepancy: {
      has_discrepancy: expectedAvailable !== balance.available_amount,
      expected_available: expectedAvailable,
      actual_available: balance.available_amount,
      difference: balance.available_amount - expectedAvailable,
    },
  }
}

export async function getAvailableCredits(
  hiveUsername: string
): Promise<number> {
  const balance = await getBalance(hiveUsername)
  return balance.available_amount
}

export async function hasSufficientCredits(
  hiveUsername: string,
  required: number
): Promise<boolean> {
  const available = await getAvailableCredits(hiveUsername)
  return available >= required
}

export async function validateOperation(
  hiveUsername: string,
  operation: 'assign' | 'claim' | 'deduct' | 'refund',
  amount: number
): Promise<{ valid: boolean; reason?: string }> {
  if (amount <= 0) {
    return { valid: false, reason: 'Amount must be positive' }
  }

  const balance = await getBalance(hiveUsername)

  if (operation === 'claim' && amount > balance.pending_amount) {
    return {
      valid: false,
      reason: `Insufficient pending credits: available ${balance.pending_amount}, required ${amount}`,
    }
  }

  if (operation === 'deduct' && amount > balance.available_amount) {
    return {
      valid: false,
      reason: `Insufficient available credits: available ${balance.available_amount}, required ${amount}`,
    }
  }

  return { valid: true }
}

export async function detectAllInconsistencies(): Promise<ConsistencyCheck[]> {
  const result = await execute({
    sql: 'SELECT hive_username FROM Credits',
    args: [],
  })

  const checks: ConsistencyCheck[] = []
  for (const row of result.rows) {
    const username = String((row as Record<string, unknown>).hive_username)
    const check = await checkConsistency(username)
    if (!check.is_consistent) checks.push(check)
  }
  return checks
}

export const creditBalanceTracker = {
  getBalance,
  getBalanceById: getBalance,
  getDetailedBalance,
  getAvailableCredits,
  hasSufficientCredits,
  validateOperation,
  checkConsistency,
  detectAllInconsistencies,
}
