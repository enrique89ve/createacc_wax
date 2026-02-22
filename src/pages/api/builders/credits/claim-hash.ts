/**
 * API: Generate claim hash for credit claiming via Keychain
 *
 * POST /api/builders/credits/claim-hash
 */

import type { APIRoute } from 'astro'
import { randomBytes } from 'crypto'
import { db } from '@/lib/database'
import { HTTP_STATUS } from '@/consts/constants'
import { BRAND } from '@/consts/branding'
import { claimHashCache } from '@/lib/claim-hash-cache'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { assertCanPerform, unauthorizedResponse } from '@/lib/admin/permissions-management'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { requireValidOrigin } from '@/utils/csrf-protection'

export const POST: APIRoute = async (context) => {
	const csrfCheck = requireValidOrigin(context.request)
	if (csrfCheck) return csrfCheck

	return withBuilderApiSession(context, async (session) => {
		try {
			assertCanPerform(session, 'CLAIM_CREDITS', 'POST /api/builders/credits/claim-hash')
		} catch {
			return unauthorizedResponse()
		}

		try {
			// Belt-and-suspenders: verify builder is active in DB for credit operations
			const builderResult = await db.execute({
				sql: 'SELECT id FROM Users WHERE id = ? AND is_active = TRUE',
				args: [session.userId],
			})

			if (builderResult.rows.length === 0) {
				return apiError(
					'Solo los builders activos pueden reclamar créditos',
					HTTP_STATUS.FORBIDDEN
				)
			}

			// Verify that there are pending credits to claim
			const pendingCreditsResult = await db.execute({
				sql: `SELECT id, pending_amount FROM Credits
					WHERE builder_id = ? AND pending_amount > 0
					LIMIT 1`,
				args: [session.userId],
			})

			if (pendingCreditsResult.rows.length === 0) {
				return apiError(
					'No hay créditos pendientes para reclamar',
					HTTP_STATUS.NOT_FOUND
				)
			}

			const pendingCredit = pendingCreditsResult.rows[0]
			const creditsToGrant = Number(pendingCredit.pending_amount)
			const creditId = Number(pendingCredit.id)

			// Opaque claim code — maps internally to creditId without exposing it
			const opaqueToken = randomBytes(12).toString('hex')
			const claimCode = `claim_${opaqueToken}`

			// Store the creditId mapping inside the hash cache (via ticketCode field)
			// claim-verify extracts creditId from this internal mapping
			claimHashCache.setCreditMapping(opaqueToken, creditId)

			// Generate hash and store in cache
			const hashData = claimHashCache.generateHash(
				session.username,
				claimCode,
				creditsToGrant
			)

			// Create the custom JSON structure for Keychain
			const customJson = {
				id: 'claim_credits',
				json: {
					app: BRAND.CLAIM_APP_ID,
					hash: hashData.hash,
					username: session.username,
					timestamp: hashData.createdAt,
					action: 'claim_credits',
				},
			}

			return apiSuccess({
				hash: hashData.hash,
				customJson,
				claimCode,
				creditsAvailable: creditsToGrant,
				expiresAt: new Date(hashData.expiresAt).toISOString(),
			})
		} catch (error) {
			return apiError(
				'Error interno del servidor',
				HTTP_STATUS.INTERNAL_SERVER_ERROR
			)
		}
	})
}
