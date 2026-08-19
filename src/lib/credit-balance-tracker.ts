/**
 * 💳 CREDIT BALANCE TRACKER
 *
 * SINGLE SOURCE OF TRUTH to consult builder credits.
 * Prevents duplications and maintains consistency.
 *
 * RULES:
 * - All endpoints must use this tracker to query credits
 * - DO NOT make direct SQL queries to the Credits table
 * - The tracker calculates in real-time from CreditAudit
 * - Automatically detects inconsistencies
 */

import { db } from './database'

/**
 * Builder credit balance with validation
 */
export interface CreditBalance {
  readonly builder_id: string
  readonly hive_username: string
  readonly pending_amount: number
  readonly available_amount: number
  readonly total_assigned: number
  readonly total_consumed: number
  readonly is_consistent: boolean
  readonly calculated_at: string
}

/**
 * Detailed balance breakdown
 */
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

/**
 * Consistency check result
 */
export interface ConsistencyCheck {
  readonly builder_id: string
  readonly is_consistent: boolean
  /** Critical inconsistencies that block operations (e.g., incorrect available_amount) */
  readonly critical_issues: string[]
  /** Informational inconsistencies that DO NOT block operations (e.g., historical total_assigned) */
  readonly warning_issues: string[]
  readonly calculated_available: number
  readonly stored_available: number
  readonly difference: number
}

class CreditBalanceTracker {
  /**
   * Direct query to the database to get credits
   * Private method - do not expose
   */
  private async queryBuilderCredits(
    where: string,
    args: Array<string | number>
  ): Promise<CreditBalance | null> {
    try {
      const result = await db.execute({
        sql: `
					SELECT
						u.id as builder_id,
						u.username as hive_username,
						COALESCE(c.pending_amount, 0) as pending_amount,
						COALESCE(c.available_amount, 0) as available_amount,
						COALESCE(c.total_assigned, 0) as total_assigned,
						COALESCE(c.total_consumed, 0) as total_consumed
					FROM "user" u
					LEFT JOIN Credits c ON u.id = c.builder_id
					WHERE u.role = 'builder' AND ${where}
				`,
        args,
      })

      if (result.rows.length === 0) {
        return null
      }

      const row = result.rows[0] as Record<string, unknown>
      const builderId = String(row.builder_id)

      // Verify consistency
      const consistency = await this.checkConsistency(builderId)

      return {
        builder_id: builderId,
        hive_username: String(row.hive_username),
        pending_amount: Number(row.pending_amount || 0),
        available_amount: Number(row.available_amount || 0),
        total_assigned: Number(row.total_assigned || 0),
        total_consumed: Number(row.total_consumed || 0),
        is_consistent: consistency.is_consistent,
        calculated_at: new Date().toISOString(),
      }
    } catch (error) {
      return null
    }
  }

  /**
   * MAIN METHOD: Get a builder's balance (by username)
   * This is the ONLY function that endpoints should use
   */
  async getBalance(hive_username: string): Promise<CreditBalance | null> {
    return this.queryBuilderCredits('u.username = ?', [hive_username])
  }

  /**
   * Get balance by builder_id
   */
  async getBalanceById(builder_id: string): Promise<CreditBalance | null> {
    return this.queryBuilderCredits('u.id = ?', [builder_id])
  }

  /**
   * Get detailed balance with breakdown
   */
  async getDetailedBalance(
    hive_username: string
  ): Promise<CreditBalanceBreakdown | null> {
    try {
      const balance = await this.getBalance(hive_username)
      if (!balance) {
        return null
      }

      // Calculate breakdown from audit
      const breakdown = await this.calculateBreakdown(balance.builder_id)

      // Calculate discrepancy (include admin_adjustments)
      const expectedAvailable =
        breakdown.claimed +
        breakdown.spent_on_tickets +
        breakdown.refunded_from_tickets +
        breakdown.admin_adjustments

      const discrepancy = {
        has_discrepancy: expectedAvailable !== balance.available_amount,
        expected_available: expectedAvailable,
        actual_available: balance.available_amount,
        difference: balance.available_amount - expectedAvailable,
      }

      return {
        ...balance,
        breakdown,
        discrepancy,
      }
    } catch (error) {
      return null
    }
  }

  /**
   * Calculate breakdown from audit
   * NOTE: Amounts in CreditAudit have signs:
   * - Positive: assign_credits, claim_credits, claim_via_blockchain, delete_ticket_refund, admin_adjustment (when adding)
   * - Negative: create_ticket, consume_credits, admin_adjustment (when subtracting)
   */
  private async calculateBreakdown(builder_id: string) {
    const result = await db.execute({
      sql: `
				SELECT
					COALESCE(SUM(CASE WHEN operation = 'assign_credits' THEN amount ELSE 0 END), 0) as assigned,
					COALESCE(SUM(CASE WHEN operation IN ('claim_credits', 'claim_via_blockchain') THEN amount ELSE 0 END), 0) as claimed,
					COALESCE(SUM(CASE WHEN operation = 'create_ticket' THEN amount ELSE 0 END), 0) as spent_on_tickets,
					COALESCE(SUM(CASE WHEN operation = 'delete_ticket_refund' THEN amount ELSE 0 END), 0) as refunded_from_tickets,
					COALESCE(SUM(CASE WHEN operation = 'consume_credits' THEN amount ELSE 0 END), 0) as consumed_on_accounts,
					COALESCE(SUM(CASE WHEN operation = 'admin_adjustment' THEN amount ELSE 0 END), 0) as admin_adjustments
				FROM CreditAudit
				WHERE builder_id = ?
			`,
      args: [builder_id],
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

  /**
   * Verify consistency between Credits and CreditAudit
   * NOTE: Only available_amount is CRITICAL and blocks operations.
   * total_assigned may differ due to historical data and is only informational.
   */
  async checkConsistency(builder_id: string): Promise<ConsistencyCheck> {
    const critical_issues: string[] = []
    const warning_issues: string[] = []

    // Get Credits data
    const creditsResult = await db.execute({
      sql: 'SELECT available_amount, total_assigned FROM Credits WHERE builder_id = ?',
      args: [builder_id],
    })

    if (creditsResult.rows.length === 0) {
      return {
        builder_id,
        is_consistent: false,
        critical_issues: ['No record in Credits table'],
        warning_issues: [],
        calculated_available: 0,
        stored_available: 0,
        difference: 0,
      }
    }

    const stored = creditsResult.rows[0] as Record<string, unknown>
    const storedAvailable = Number(stored.available_amount || 0)
    const storedAssigned = Number(stored.total_assigned || 0)

    // Calculate from audit
    const breakdown = await this.calculateBreakdown(builder_id)

    // Include admin_adjustments in available calculation
    const calculatedAvailable =
      breakdown.claimed +
      breakdown.spent_on_tickets +
      breakdown.refunded_from_tickets +
      breakdown.admin_adjustments

    const calculatedAssigned = breakdown.assigned

    // Verify available_amount discrepancy (CRITICAL - blocks operations)
    if (calculatedAvailable !== storedAvailable) {
      critical_issues.push(
        `inconsistent available_amount: expected ${calculatedAvailable}, actual ${storedAvailable}`
      )
    }

    // Verify total_assigned discrepancy (WARNING - only informational)
    if (calculatedAssigned !== storedAssigned) {
      warning_issues.push(
        `inconsistent total_assigned: expected ${calculatedAssigned}, actual ${storedAssigned} (historical data)`
      )
    }

    return {
      builder_id,
      is_consistent: critical_issues.length === 0,
      critical_issues,
      warning_issues,
      calculated_available: calculatedAvailable,
      stored_available: storedAvailable,
      difference: storedAvailable - calculatedAvailable,
    }
  }

  /**
   * Detect duplicate assignments within a time range
   */
  async detectDuplicateAssignments(seconds: number = 5): Promise<
    Array<{
      builder_id: string
      timestamp: string
      count: number
      total_amount: number
    }>
  > {
    const result = await db.execute({
      sql: `
				SELECT
					builder_id,
					timestamp,
					COUNT(*) as count,
					SUM(amount) as total_amount
				FROM CreditAudit
				WHERE operation = 'assign_credits'
					AND timestamp >= datetime('now', '-' || ? || ' seconds')
				GROUP BY builder_id, timestamp
				HAVING count > 1
				ORDER BY timestamp DESC
			`,
      args: [seconds],
    })

    return result.rows.map((row: Record<string, unknown>) => ({
      builder_id: String(row.builder_id),
      timestamp: String(row.timestamp),
      count: Number(row.count),
      total_amount: Number(row.total_amount),
    }))
  }

  /**
   * Get only available credits (fast method)
   */
  async getAvailableCredits(hive_username: string): Promise<number> {
    const balance = await this.getBalance(hive_username)
    return balance?.available_amount ?? 0
  }

  /**
   * Check if a builder has enough credits
   */
  async hasSufficientCredits(
    hive_username: string,
    required: number
  ): Promise<boolean> {
    const available = await this.getAvailableCredits(hive_username)
    return available >= required
  }

  /**
   * Get balance of multiple builders
   */
  async getBulkBalances(
    usernames: string[]
  ): Promise<Map<string, CreditBalance>> {
    const balances = new Map<string, CreditBalance>()

    for (const username of usernames) {
      const balance = await this.getBalance(username)
      if (balance) {
        balances.set(username, balance)
      }
    }

    return balances
  }

  /**
   * Validate that a credit operation is safe before executing it
   */
  async validateOperation(
    builder_id: string,
    operation: 'assign' | 'claim' | 'deduct' | 'refund',
    amount: number
  ): Promise<{ valid: boolean; reason?: string }> {
    if (amount <= 0) {
      return { valid: false, reason: 'Amount must be positive' }
    }

    const balance = await this.getBalanceById(builder_id)
    if (!balance) {
      return { valid: false, reason: 'Builder not found' }
    }

    // Verify consistency first
    if (!balance.is_consistent) {
      return {
        valid: false,
        reason: 'Builder balance has inconsistencies',
      }
    }

    switch (operation) {
      case 'claim':
        if (amount > balance.pending_amount) {
          return {
            valid: false,
            reason: `Insufficient pending credits: available ${balance.pending_amount}, required ${amount}`,
          }
        }
        break

      case 'deduct':
        if (amount > balance.available_amount) {
          return {
            valid: false,
            reason: `Insufficient available credits: available ${balance.available_amount}, required ${amount}`,
          }
        }
        break

      case 'assign':
      case 'refund':
        // These operations are always valid if the amount is positive
        break
    }

    return { valid: true }
  }

  /**
   * Detect all inconsistencies in the system
   */
  async detectAllInconsistencies(): Promise<ConsistencyCheck[]> {
    // Get all builders with credits
    const buildersResult = await db.execute({
      sql: 'SELECT DISTINCT builder_id FROM Credits',
      args: [],
    })

    const checks: ConsistencyCheck[] = []

    for (const row of buildersResult.rows) {
      const builderId = String((row as Record<string, unknown>).builder_id)
      const check = await this.checkConsistency(builderId)

      if (!check.is_consistent) {
        checks.push(check)
      }
    }

    return checks
  }
}

// Singleton instance
export const creditBalanceTracker = new CreditBalanceTracker()
