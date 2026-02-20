/**
 * CREDITS SERVICE - Simplificado
 *
 * Sistema simplificado de créditos con 1 fila por builder
 * Columnas: pending_amount, available_amount, total_assigned, total_consumed
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
 * Información completa de créditos de un builder
 */
export interface BuilderCreditsInfo {
  builder_id: number
  hive_username: string
  pending_amount: number // Asignados pero no reclamados
  available_amount: number // Reclamados y disponibles para crear tickets
  total_assigned: number // Total histórico asignado
  total_consumed: number // Total histórico consumido
}

/**
 * Operación para asignar créditos
 */
export interface AssignCreditsOperation {
  hive_username: string
  amount: number
  source: string
  assigned_by_admin: number
}

class CreditsService {
  /**
   * Obtener o crear fila de créditos para un builder
   * Si no existe, la crea automáticamente
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
   * 1. Asignar créditos a un builder (admin → builder)
   * Incrementa: pending_amount, total_assigned
   * Crea el builder automáticamente si no existe
   */
  async assignCredits(
    operation: AssignCreditsOperation
  ): Promise<BuilderCreditsInfo> {
    try {
      // Buscar o crear builder
      let builderResult = await db.execute({
        sql: "SELECT id FROM Users WHERE role = 'builder' AND username = ?",
        args: [operation.hive_username],
      })

      let builder_id: number

      if (builderResult.rows.length === 0) {
        // Crear builder automáticamente
        const createResult = await db.execute({
          sql: 'INSERT INTO Users (username, role, is_active, password_hash) VALUES (?, ?, ?, ?)',
          args: [operation.hive_username, 'builder', true, null],
        })
        builder_id = Number(createResult.lastInsertRowid)
      } else {
        builder_id = (builderResult.rows[0] as unknown as UserIdRow).id
      }

      // Asegurar que existe fila de créditos
      await this.getOrCreateCreditRow(builder_id)

      // Incrementar pending_amount y total_assigned
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

      // Crear entrada de auditoría
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

      // Crear notificación de créditos pendientes
      try {
        await notifyPendingCredits(builder_id, operation.amount)
      } catch (notificationError) {
        // No fallar si la notificación falla, solo loguear
        logger.error('Failed to create notification:', notificationError)
      }

      // Retornar información actualizada
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
   * 2. Reclamar créditos (pending → available)
   * Decrementa: pending_amount
   * Incrementa: available_amount
   *
   * SEGURIDAD: Operación atómica para prevenir race conditions.
   */
  async claimCredits(builder_id: number, amount: number): Promise<void> {
    // Operación atómica: solo actualiza si hay suficientes créditos pendientes
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

    // Si no se actualizó ninguna fila, no había suficientes créditos pendientes
    if (result.rowsAffected === 0) {
      throw new Error('Créditos pendientes insuficientes')
    }

    // Auditoría (solo si el claim fue exitoso)
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
   * 3. Descontar créditos al crear ticket
   * Decrementa: available_amount
   *
   * SEGURIDAD: Operación atómica para prevenir race conditions.
   * El UPDATE solo afecta filas donde available_amount >= amount,
   * garantizando que no se pueden gastar más créditos de los disponibles
   * incluso con requests concurrentes.
   */
  async deductCreditsForTicket(
    builder_id: number,
    amount: number,
    ticket_code: string
  ): Promise<void> {
    // Operación atómica: solo actualiza si hay suficientes créditos
    // El WHERE available_amount >= ? previene race conditions
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

    // Si no se actualizó ninguna fila, no había suficientes créditos
    if (result.rowsAffected === 0) {
      throw new Error('Créditos insuficientes')
    }

    // Auditoría (solo si la deducción fue exitosa)
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
   * 4. Marcar créditos como consumidos al crear cuenta
   * Incrementa: total_consumed
   * Nota: Los créditos YA fueron descontados al crear el ticket
   */
  async markCreditsAsConsumed(
    builder_id: number,
    amount: number,
    account_username: string
  ): Promise<void> {
    try {
      // Incrementar contador total_consumed
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

      // Auditoría
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
   * 5. Reembolsar créditos al borrar ticket
   * Incrementa: available_amount
   */
  async refundCreditsFromTicket(
    builder_id: number,
    amount: number,
    ticket_code: string
  ): Promise<void> {
    try {
      // Incrementar available_amount
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

      // Auditoría
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
   * Obtener historial de auditoría de créditos de un builder
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
   * Transferir créditos entre builders
   *
   * SEGURIDAD: Operación atómica para prevenir race conditions.
   * El UPDATE del remitente usa WHERE available_amount >= amount
   * para garantizar que no se transfieran más créditos de los disponibles,
   * incluso con requests concurrentes.
   */
  async transferCredits(
    from_builder_id: number,
    to_builder_id: number,
    amount: number
  ): Promise<void> {
    // Validación básica
    if (from_builder_id === to_builder_id) {
      throw new Error('No se puede transferir créditos a uno mismo')
    }

    if (amount <= 0) {
      throw new Error('El monto debe ser mayor a 0')
    }

    // Verificar que builder destino existe
    const toBuilderResult = await db.execute({
      sql: "SELECT id FROM Users WHERE role = 'builder' AND id = ?",
      args: [to_builder_id],
    })

    if (toBuilderResult.rows.length === 0) {
      throw new Error('Builder destino no encontrado')
    }

    // Asegurar que ambos builders tienen fila de créditos
    await this.getOrCreateCreditRow(from_builder_id)
    await this.getOrCreateCreditRow(to_builder_id)

    await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

    try {
      // Operación atómica: descontar del remitente SOLO si tiene suficientes créditos
      // El WHERE available_amount >= ? previene race conditions
      const deductResult = await db.execute({
        sql: `
          UPDATE Credits
          SET available_amount = available_amount - ?, updated_at = CURRENT_TIMESTAMP
          WHERE builder_id = ? AND available_amount >= ?
        `,
        args: [amount, from_builder_id, amount],
      })

      // Si no se actualizó ninguna fila, no había suficientes créditos
      if (deductResult.rowsAffected === 0) {
        throw new Error('Créditos disponibles insuficientes para transferencia')
      }

      // Agregar al destinatario (seguro porque ya validamos el origen)
      await db.execute({
        sql: `
          UPDATE Credits
          SET available_amount = available_amount + ?, updated_at = CURRENT_TIMESTAMP
          WHERE builder_id = ?
        `,
        args: [amount, to_builder_id],
      })

      // Auditoría para remitente
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

      // Auditoría para destinatario
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
   * 6. Ajuste directo de créditos por admin (establecer valores absolutos)
   * Permite establecer directamente pending_amount y/o available_amount
   * Solo para uso de administradores en caso de correcciones
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

    // Obtener valores actuales
    const currentCredits = await creditBalanceTracker.getBalanceById(builder_id)
    if (!currentCredits) {
      throw new Error('Builder no encontrado')
    }

    // Calcular diferencias para auditoría
    const pendingDiff =
      pending_amount !== undefined
        ? pending_amount - currentCredits.pending_amount
        : 0
    const availableDiff =
      available_amount !== undefined
        ? available_amount - currentCredits.available_amount
        : 0

    // Solo actualizar si hay cambios
    if (pendingDiff === 0 && availableDiff === 0) {
      return currentCredits
    }

    await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

    try {
      // Construir UPDATE dinámico
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

      // Registrar auditoría con detalles del ajuste
      // NOTA: amount = availableDiff porque el breakdown calcula available_amount desde auditoría
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

    // Retornar información actualizada
    const updatedCredits = await creditBalanceTracker.getBalanceById(builder_id)
    if (!updatedCredits) {
      throw new Error('Error al obtener créditos actualizados')
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
   * Obtener historial de créditos de un builder
   * @param builderId - ID del builder
   * @returns Array de operaciones de créditos ordenadas por timestamp DESC
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
