/**
 * API: Verify claim transaction and process credit claim
 *
 * POST /api/builders/credits/claim-verify
 *
 * Flow: validate hash (non-destructive) → verify blockchain tx →
 *       DB transaction → consume hash ONLY after successful COMMIT.
 *       If the transaction rolls back, the hash survives and the user can retry.
 */

import type { APIRoute } from 'astro'
import { db, withTransaction } from '@/lib/database'
import { logger } from '@/lib/logger'
import { HTTP_STATUS } from '@/consts/constants'
import { verifyClaimTransaction } from '@/lib/hive-transaction-verifier'
import { claimHashCache } from '@/lib/claim-hash-cache'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { assertCanPerform, unauthorizedResponse } from '@/lib/admin/permissions-management'
import { requireValidOrigin } from '@/utils/csrf-protection'
import { apiSuccess, apiError } from '@/utils/errorResponse'

/** Runtime-validated claim-verify request shape */
type ClaimVerifyRequest = {
	readonly transactionId: string
	readonly hash: string
}

const OPAQUE_CLAIM_PATTERN = /^claim_([a-f0-9]{24})$/

/**
 * Narrows unknown input to ClaimVerifyRequest or returns null.
 * Boundary proof: validates every field before the type assertion.
 */
function parseClaimVerifyBody(body: unknown): ClaimVerifyRequest | null {
	if (typeof body !== 'object' || body === null) return null

	const record = body as Record<string, unknown>
	const transactionId = record.transactionId
	const hash = record.hash

	if (typeof transactionId !== 'string' || transactionId.length === 0) return null
	if (typeof hash !== 'string' || hash.length === 0) return null

	return { transactionId, hash }
}

export const POST: APIRoute = async (context) => {
	const csrfCheck = requireValidOrigin(context.request)
	if (csrfCheck) return csrfCheck

	return withBuilderApiSession(context, async (session) => {
		try {
			assertCanPerform(session, 'CLAIM_CREDITS', 'POST /api/builders/credits/claim-verify')
		} catch {
			return unauthorizedResponse()
		}

		try {
			const rawBody: unknown = await context.request.json()
			const parsed = parseClaimVerifyBody(rawBody)

			if (!parsed) {
				return apiError(
					'Transaction ID y hash son requeridos',
					HTTP_STATUS.BAD_REQUEST
				)
			}

			const { transactionId, hash } = parsed

			// 1. Validate hash (non-destructive — hash stays in cache)
			const hashData = claimHashCache.validate(hash, session.username)
			if (!hashData) {
				return apiError(
					'Hash de validación no encontrado, inválido o expirado',
					HTTP_STATUS.NOT_FOUND
				)
			}

			// 2. Verify blockchain transaction (parallelizable with builder check)
			const [verificationResult, builderResult] = await Promise.all([
				verifyClaimTransaction(transactionId, hash, session.username),
				db.execute({
					sql: 'SELECT id FROM Users WHERE id = ? AND is_active = TRUE',
					args: [session.userId],
				}),
			])

			if (!verificationResult.valid) {
				return apiError(
					verificationResult.error || 'Transacción inválida',
					HTTP_STATUS.BAD_REQUEST
				)
			}

			if (builderResult.rows.length === 0) {
				return apiError(
					'Solo los builders activos pueden reclamar créditos',
					HTTP_STATUS.FORBIDDEN
				)
			}

			// 3. Resolve creditId from opaque claim token
			const opaqueMatch = hashData.ticketCode.match(OPAQUE_CLAIM_PATTERN)
			if (!opaqueMatch) {
				return apiError(
					'Código de claim inválido',
					HTTP_STATUS.BAD_REQUEST
				)
			}

			const creditId = claimHashCache.getCreditMapping(opaqueMatch[1])
			if (creditId === null) {
				return apiError(
					'Código de claim expirado o ya consumido',
					HTTP_STATUS.NOT_FOUND
				)
			}
			const creditsToAdd = hashData.creditsAvailable

			// 4. Verify credit record exists and has sufficient pending
			const creditResult = await db.execute({
				sql: 'SELECT id, pending_amount FROM Credits WHERE id = ? AND builder_id = ?',
				args: [creditId, session.userId],
			})

			if (creditResult.rows.length === 0) {
				return apiError(
					'Registro de créditos no encontrado',
					HTTP_STATUS.NOT_FOUND
				)
			}

			const currentPending = Number(creditResult.rows[0].pending_amount)

			if (currentPending < creditsToAdd) {
				return apiError(
					'Créditos pendientes insuficientes',
					HTTP_STATUS.CONFLICT
				)
			}

			// 5. Atomic DB transaction — hash is NOT consumed yet
			await withTransaction(async () => {
				await db.execute({
					sql: `UPDATE Credits
						SET pending_amount = pending_amount - ?,
							available_amount = available_amount + ?,
							updated_at = CURRENT_TIMESTAMP
						WHERE id = ? AND pending_amount >= ?`,
					args: [creditsToAdd, creditsToAdd, creditId, creditsToAdd],
				})

				await db.execute({
					sql: `INSERT INTO CreditAudit (
						builder_id, operation, amount, reason, timestamp
					) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
					args: [
						session.userId,
						'claim_via_blockchain',
						creditsToAdd,
						`Claimed via transaction: ${transactionId}`,
					],
				})
			})

			// 6. COMMIT succeeded — NOW consume the hash (one-time use)
			claimHashCache.consume(hash)

			const balanceResult = await db.execute({
				sql: 'SELECT available_amount FROM Credits WHERE id = ?',
				args: [creditId],
			})

			const newBalance = Number(balanceResult.rows[0]?.available_amount ?? 0)

			return apiSuccess({
				message: 'Créditos reclamados exitosamente',
				credits: creditsToAdd,
				transactionId,
				newBalance,
			})
		} catch (error) {
			logger.error('Error en claim-verify:', error)
			return apiError(
				'Error interno del servidor',
				HTTP_STATUS.INTERNAL_SERVER_ERROR
			)
		}
	})
}
