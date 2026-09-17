/**
 * API: Generate claim hash for credit claiming via Keychain
 *
 * POST /api/builders/credits/claim-hash
 */

import type { APIRoute } from 'astro'
import { HTTP_STATUS } from '@/consts/constants'
import { BRAND } from '@/consts/branding'
import {
  CLAIM_SERVICE_ERRORS,
  createClaimIntent,
} from '@/lib/credits/claim-service'
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
      const intentResult = await createClaimIntent(session.username)
      if (!intentResult.ok) {
        if (intentResult.code === CLAIM_SERVICE_ERRORS.NO_PENDING) {
          return apiError(
            'No hay créditos pendientes para reclamar',
            HTTP_STATUS.NOT_FOUND
          )
        }
        return apiError(
          'No se pudo generar el intent de claim',
          HTTP_STATUS.INTERNAL_SERVER_ERROR
        )
      }

      const { intent } = intentResult

      // Create the custom JSON structure for Keychain
      const customJson = {
        id: 'claim_credits',
        json: {
          app: BRAND.CLAIM_APP_ID,
          hash: intent.hash,
          username: session.username,
          timestamp: intent.createdAt,
          action: 'claim_credits',
        },
      }

      return apiSuccess(
        {
          hash: intent.hash,
          customJson,
          creditsAvailable: intent.amount,
          expiresAt: new Date(intent.expiresAt).toISOString(),
        },
        HTTP_STATUS.OK,
        { noCache: true }
      )
    } catch (error) {
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
