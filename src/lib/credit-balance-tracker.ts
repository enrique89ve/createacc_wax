/**
 * 💳 CREDIT BALANCE TRACKER
 *
 * ÚNICA FUENTE DE VERDAD para consultar créditos de builders.
 * Previene duplicaciones y mantiene consistencia.
 *
 * REGLAS:
 * - Todos los endpoints deben usar este tracker para consultar créditos
 * - NO hacer queries SQL directas a la tabla Credits
 * - El tracker calcula en tiempo real desde CreditAudit
 * - Detecta automáticamente inconsistencias
 */

import { db } from './database'

/**
 * Balance de créditos de un builder con validación
 */
export interface CreditBalance {
  readonly builder_id: number
  readonly hive_username: string
  readonly pending_amount: number
  readonly available_amount: number
  readonly total_assigned: number
  readonly total_consumed: number
  readonly is_consistent: boolean
  readonly calculated_at: string
}

/**
 * Desglose detallado del balance
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
 * Resultado de verificación de consistencia
 */
export interface ConsistencyCheck {
  readonly builder_id: number
  readonly is_consistent: boolean
  readonly issues: string[]
  readonly calculated_available: number
  readonly stored_available: number
  readonly difference: number
}

class CreditBalanceTracker {
  /**
   * Query directa a la base de datos para obtener créditos
   * Método privado - no exponer
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
					FROM Users u
					LEFT JOIN Credits c ON u.id = c.builder_id
					WHERE u.role = 'builder' AND ${where}
				`,
        args,
      })

      if (result.rows.length === 0) {
        return null
      }

      const row = result.rows[0] as Record<string, unknown>
      const builderId = Number(row.builder_id)

      // Verificar consistencia
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
   * MÉTODO PRINCIPAL: Obtener balance de un builder (por username)
   * Esta es la ÚNICA función que deben usar los endpoints
   */
  async getBalance(hive_username: string): Promise<CreditBalance | null> {
    return this.queryBuilderCredits('u.username = ?', [hive_username])
  }

  /**
   * Obtener balance por builder_id
   */
  async getBalanceById(builder_id: number): Promise<CreditBalance | null> {
    return this.queryBuilderCredits('u.id = ?', [builder_id])
  }

  /**
   * Obtener balance detallado con desglose
   */
  async getDetailedBalance(
    hive_username: string
  ): Promise<CreditBalanceBreakdown | null> {
    try {
      const balance = await this.getBalance(hive_username)
      if (!balance) {
        return null
      }

      // Calcular desglose desde auditoría
      const breakdown = await this.calculateBreakdown(balance.builder_id)

      // Calcular discrepancia
      const expectedAvailable =
        breakdown.claimed +
        breakdown.spent_on_tickets +
        breakdown.refunded_from_tickets

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
   * Calcular desglose desde auditoría
   * NOTA: Los amounts en CreditAudit tienen signo:
   * - Positivos: assign_credits, claim_credits, claim_via_blockchain, delete_ticket_refund
   * - Negativos: create_ticket, consume_credits
   */
  private async calculateBreakdown(builder_id: number) {
    const result = await db.execute({
      sql: `
				SELECT
					COALESCE(SUM(CASE WHEN operation = 'assign_credits' THEN amount ELSE 0 END), 0) as assigned,
					COALESCE(SUM(CASE WHEN operation IN ('claim_credits', 'claim_via_blockchain') THEN amount ELSE 0 END), 0) as claimed,
					COALESCE(SUM(CASE WHEN operation = 'create_ticket' THEN amount ELSE 0 END), 0) as spent_on_tickets,
					COALESCE(SUM(CASE WHEN operation = 'delete_ticket_refund' THEN amount ELSE 0 END), 0) as refunded_from_tickets,
					COALESCE(SUM(CASE WHEN operation = 'consume_credits' THEN amount ELSE 0 END), 0) as consumed_on_accounts
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
    }
  }

  /**
   * Verificar consistencia entre Credits y CreditAudit
   */
  async checkConsistency(builder_id: number): Promise<ConsistencyCheck> {
    const issues: string[] = []

    // Obtener datos de Credits
    const creditsResult = await db.execute({
      sql: 'SELECT available_amount, total_assigned FROM Credits WHERE builder_id = ?',
      args: [builder_id],
    })

    if (creditsResult.rows.length === 0) {
      return {
        builder_id,
        is_consistent: false,
        issues: ['No existe registro en tabla Credits'],
        calculated_available: 0,
        stored_available: 0,
        difference: 0,
      }
    }

    const stored = creditsResult.rows[0] as Record<string, unknown>
    const storedAvailable = Number(stored.available_amount || 0)
    const storedAssigned = Number(stored.total_assigned || 0)

    // Calcular desde auditoría
    const breakdown = await this.calculateBreakdown(builder_id)

    const calculatedAvailable =
      breakdown.claimed +
      breakdown.spent_on_tickets +
      breakdown.refunded_from_tickets

    const calculatedAssigned = breakdown.assigned

    // Verificar discrepancias
    if (calculatedAvailable !== storedAvailable) {
      issues.push(
        `available_amount inconsistente: esperado ${calculatedAvailable}, actual ${storedAvailable}`
      )
    }

    if (calculatedAssigned !== storedAssigned) {
      issues.push(
        `total_assigned inconsistente: esperado ${calculatedAssigned}, actual ${storedAssigned}`
      )
    }

    return {
      builder_id,
      is_consistent: issues.length === 0,
      issues,
      calculated_available: calculatedAvailable,
      stored_available: storedAvailable,
      difference: storedAvailable - calculatedAvailable,
    }
  }

  /**
   * Detectar asignaciones duplicadas en un rango de tiempo
   */
  async detectDuplicateAssignments(seconds: number = 5): Promise<
    Array<{
      builder_id: number
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
      builder_id: Number(row.builder_id),
      timestamp: String(row.timestamp),
      count: Number(row.count),
      total_amount: Number(row.total_amount),
    }))
  }

  /**
   * Obtener solo los créditos disponibles (método rápido)
   */
  async getAvailableCredits(hive_username: string): Promise<number> {
    const balance = await this.getBalance(hive_username)
    return balance?.available_amount ?? 0
  }

  /**
   * Verificar si un builder tiene suficientes créditos
   */
  async hasSufficientCredits(
    hive_username: string,
    required: number
  ): Promise<boolean> {
    const available = await this.getAvailableCredits(hive_username)
    return available >= required
  }

  /**
   * Obtener balance de múltiples builders
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
   * Validar que una operación de créditos es segura antes de ejecutarla
   */
  async validateOperation(
    builder_id: number,
    operation: 'assign' | 'claim' | 'deduct' | 'refund',
    amount: number
  ): Promise<{ valid: boolean; reason?: string }> {
    if (amount <= 0) {
      return { valid: false, reason: 'El monto debe ser positivo' }
    }

    const balance = await this.getBalanceById(builder_id)
    if (!balance) {
      return { valid: false, reason: 'Builder no encontrado' }
    }

    // Verificar consistencia primero
    if (!balance.is_consistent) {
      return {
        valid: false,
        reason: 'El balance del builder tiene inconsistencias',
      }
    }

    switch (operation) {
      case 'claim':
        if (amount > balance.pending_amount) {
          return {
            valid: false,
            reason: `Créditos pendientes insuficientes: disponible ${balance.pending_amount}, requerido ${amount}`,
          }
        }
        break

      case 'deduct':
        if (amount > balance.available_amount) {
          return {
            valid: false,
            reason: `Créditos disponibles insuficientes: disponible ${balance.available_amount}, requerido ${amount}`,
          }
        }
        break

      case 'assign':
      case 'refund':
        // Estas operaciones siempre son válidas si el monto es positivo
        break
    }

    return { valid: true }
  }

  /**
   * Detectar todas las inconsistencias en el sistema
   */
  async detectAllInconsistencies(): Promise<ConsistencyCheck[]> {
    // Obtener todos los builders con créditos
    const buildersResult = await db.execute({
      sql: 'SELECT DISTINCT builder_id FROM Credits',
      args: [],
    })

    const checks: ConsistencyCheck[] = []

    for (const row of buildersResult.rows) {
      const builderId = Number((row as Record<string, unknown>).builder_id)
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
