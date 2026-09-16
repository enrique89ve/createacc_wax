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
import { assertCanPerform, unauthorizedResponse } from '@/lib/auth/permissions'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { requireValidOrigin } from '@/utils/csrf-protection'

export const POST: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withBuilderApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        'CLAIM_CREDITS',
        'POST /api/builders/credits/claim-hash'
      )
    } catch {
      return unauthorizedResponse()
    }

    try {
      const pendingCreditsResult = await db.execute({
        sql: `SELECT hive_username, pending_amount FROM Credits
					WHERE hive_username = ? AND pending_amount > 0
					LIMIT 1`,
        args: [session.username],
      })

      if (pendingCreditsResult.rows.length === 0) {
        return apiError(
          'No hay créditos pendientes para reclamar',
          HTTP_STATUS.NOT_FOUND
        )
      }

      const pendingCredit = pendingCreditsResult.rows[0]
      const creditsToGrant = Number(pendingCredit.pending_amount)

      const opaqueToken = randomBytes(12).toString('hex')
      const claimCode = `claim_${opaqueToken}`
      claimHashCache.setCreditMapping(opaqueToken, 0)

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
