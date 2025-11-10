/**
 * 💳 CREDITS SERVICE - Simplificado
 *
 * Sistema simplificado de créditos con 1 fila por builder
 * Columnas: pending_amount, available_amount, total_assigned, total_consumed
 */

import { db } from './database'
import type { DatabaseCreditRow } from '@/types/database'

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
	 * Obtener información completa de créditos por hive_username
	 */
	async getBuilderCredits(
		hive_username: string
	): Promise<BuilderCreditsInfo | null> {
		try {
			const result = await db.execute({
				sql: `
					SELECT
						b.id as builder_id,
						b.hive_username,
						COALESCE(c.pending_amount, 0) as pending_amount,
						COALESCE(c.available_amount, 0) as available_amount,
						COALESCE(c.total_assigned, 0) as total_assigned,
						COALESCE(c.total_consumed, 0) as total_consumed
					FROM Builders b
					LEFT JOIN Credits c ON b.id = c.builder_id
					WHERE b.hive_username = ?
				`,
				args: [hive_username],
			})

			if (result.rows.length === 0) {
				return null
			}

			return result.rows[0] as unknown as BuilderCreditsInfo
		} catch (error) {
			throw error
		}
	}

	/**
	 * Obtener información completa de créditos por builder_id
	 */
	async getBuilderCreditsByBuilderId(
		builder_id: number
	): Promise<BuilderCreditsInfo | null> {
		try {
			const result = await db.execute({
				sql: `
					SELECT
						b.id as builder_id,
						b.hive_username,
						COALESCE(c.pending_amount, 0) as pending_amount,
						COALESCE(c.available_amount, 0) as available_amount,
						COALESCE(c.total_assigned, 0) as total_assigned,
						COALESCE(c.total_consumed, 0) as total_consumed
					FROM Builders b
					LEFT JOIN Credits c ON b.id = c.builder_id
					WHERE b.id = ?
				`,
				args: [builder_id],
			})

			if (result.rows.length === 0) {
				return null
			}

			return result.rows[0] as unknown as BuilderCreditsInfo
		} catch (error) {
			throw error
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
				sql: 'SELECT id FROM Builders WHERE hive_username = ?',
				args: [operation.hive_username],
			})

			let builder_id: number

			if (builderResult.rows.length === 0) {
				// Crear builder automáticamente
				const createResult = await db.execute({
					sql: 'INSERT INTO Builders (hive_username, is_active) VALUES (?, ?)',
					args: [operation.hive_username, true],
				})
				builder_id = Number(createResult.lastInsertRowid)
			} else {
				builder_id = (builderResult.rows[0] as any).id
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
						builder_id, operation, amount, reason, performed_by_admin, timestamp
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

			// Retornar información actualizada
			const credits = await this.getBuilderCreditsByBuilderId(builder_id)
			if (!credits) {
				throw new Error('Failed to retrieve updated credits')
			}
			return credits
		} catch (error) {
			throw error
		}
	}

	/**
	 * 2. Reclamar créditos (pending → available)
	 * Decrementa: pending_amount
	 * Incrementa: available_amount
	 */
	async claimCredits(builder_id: number, amount: number): Promise<void> {
		try {
			// Verificar que hay suficientes créditos pendientes
			const credits = await this.getBuilderCreditsByBuilderId(builder_id)
			if (!credits || credits.pending_amount < amount) {
				throw new Error(
				)
			}

			// Mover de pending a available
			await db.execute({
				sql: `
					UPDATE Credits
					SET
						pending_amount = pending_amount - ?,
						available_amount = available_amount + ?,
						updated_at = CURRENT_TIMESTAMP
					WHERE builder_id = ?
				`,
				args: [amount, amount, builder_id],
			})

			// Auditoría
			await db.execute({
				sql: `
					INSERT INTO CreditAudit (
						builder_id, operation, amount, reason, timestamp
					) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
				`,
				args: [builder_id, 'claim_credits', amount, 'claimed by builder'],
			})
		} catch (error) {
			throw error
		}
	}

	/**
	 * 3. Descontar créditos al crear ticket
	 * Decrementa: available_amount
	 */
	async deductCreditsForTicket(
		builder_id: number,
		amount: number,
		ticket_code: string
	): Promise<void> {
		try {
			// Verificar que hay suficientes créditos disponibles
			const credits = await this.getBuilderCreditsByBuilderId(builder_id)
			if (!credits || credits.available_amount < amount) {
				throw new Error(
				)
			}

			// Descontar de available_amount
			await db.execute({
				sql: `
					UPDATE Credits
					SET
						available_amount = available_amount - ?,
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
					'create_ticket',
					-amount,
					`ticket created: ${ticket_code}`,
				],
			})
		} catch (error) {
			throw error
		}
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
	 * Obtener créditos disponibles de un builder
	 */
	async getAvailableCredits(builder_id: number): Promise<number> {
		const result = await db.execute({
			sql: 'SELECT COALESCE(available_amount, 0) as available FROM Credits WHERE builder_id = ?',
			args: [builder_id],
		})

		if (result.rows.length === 0) {
			return 0
		}

		return (result.rows[0] as any).available
	}

	/**
	 * Obtener historial de auditoría de créditos de un builder
	 */
	async getCreditAuditHistory(builder_id: number) {
		const result = await db.execute({
			sql: `
				SELECT * FROM CreditAudit
				WHERE builder_id = ?
				ORDER BY timestamp DESC
			`,
			args: [builder_id],
		})

		return result.rows
	}

	/**
	 * Transferir créditos entre builders
	 */
	async transferCredits(
		from_builder_id: number,
		to_builder_id: number,
		amount: number
	): Promise<void> {
		try {
			// Verificar créditos suficientes
			const fromCredits = await this.getAvailableCredits(from_builder_id)
			if (fromCredits < amount) {
				throw new Error('Créditos disponibles insuficientes para transferencia')
			}

			// Verificar que builder destino existe
			const toBuilderResult = await db.execute({
				sql: 'SELECT id FROM Builders WHERE id = ?',
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
				// Descontar del remitente
				await db.execute({
					sql: `
						UPDATE Credits
						SET available_amount = available_amount - ?, updated_at = CURRENT_TIMESTAMP
						WHERE builder_id = ?
					`,
					args: [amount, from_builder_id],
				})

				// Agregar al destinatario
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
		} catch (error) {
			throw error
		}
	}

	/**
	 * Alias para compatibilidad con código existente
	 */
	async getUserCredits(hive_username: string) {
		const builderCredits = await this.getBuilderCredits(hive_username)

		if (!builderCredits) {
			return null
		}

		// Retornar en formato compatible
		return {
			active_credits: builderCredits.pending_amount, // Créditos pendientes de reclamar
			total_credits: builderCredits.available_amount, // Créditos disponibles para usar
			consumed_credits: builderCredits.total_consumed,
			credit_limit: 0,
		}
	}
}

// Singleton instance
export const creditsService = new CreditsService()
