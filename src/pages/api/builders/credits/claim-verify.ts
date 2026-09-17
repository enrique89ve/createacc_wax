/**
 * API: Verify claim transaction and process credit claim
 *
 * POST /api/builders/credits/claim-verify
 *
 * Flow: verify blockchain tx → consume persistent intent and move Credits in one
 *       DB transaction. If the transaction rolls back, the intent survives.
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { HTTP_STATUS } from '@/consts/constants'
import { verifyHiveClaim } from '@/lib/credits/adapters/hive-claim-adapter'
import {
  completeClaim,
  CLAIM_SERVICE_ERRORS,
} from '@/lib/credits/claim-service'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { assertCanPerform, unauthorizedResponse } from '@/lib/auth/permissions'
import { requireValidOrigin } from '@/utils/csrf-protection'
import { apiSuccess, apiError } from '@/utils/errorResponse'

/** Runtime-validated claim-verify request shape */
type ClaimVerifyRequest = {
  readonly transactionId: string
  readonly hash: string
}

/**
 * Narrows unknown input to ClaimVerifyRequest or returns null.
 * Boundary proof: validates every field before the type assertion.
 */
function parseClaimVerifyBody(body: unknown): ClaimVerifyRequest | null {
  if (typeof body !== 'object' || body === null) return null

  const record = body as Record<string, unknown>
  const transactionId = record.transactionId
  const hash = record.hash

  if (typeof transactionId !== 'string' || transactionId.length === 0)
    return null
  if (typeof hash !== 'string' || hash.length === 0) return null

  return { transactionId, hash }
}

export const POST: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withBuilderApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        'CLAIM_CREDITS',
        'POST /api/builders/credits/claim-verify'
      )
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

      const verificationResult = await verifyHiveClaim({
        transactionId,
        hash,
        username: session.username,
      })

      if (!verificationResult.ok) {
        if (verificationResult.kind === 'unavailable') {
          return apiError(
            'El proveedor Hive no está disponible temporalmente',
            HTTP_STATUS.SERVICE_UNAVAILABLE
          )
        }
        return apiError(verificationResult.error, HTTP_STATUS.BAD_REQUEST)
      }

      const completion = await completeClaim(verificationResult.claim)
      if (!completion.ok) {
        if (completion.code === CLAIM_SERVICE_ERRORS.INTENT_NOT_FOUND) {
          return apiError(
            'Hash de validación no encontrado, inválido o expirado',
            HTTP_STATUS.NOT_FOUND
          )
        }
        if (
          completion.code === CLAIM_SERVICE_ERRORS.INSUFFICIENT_PENDING ||
          completion.code === CLAIM_SERVICE_ERRORS.DUPLICATE_REFERENCE
        ) {
          return apiError(completion.error, HTTP_STATUS.CONFLICT)
        }
        if (completion.code === CLAIM_SERVICE_ERRORS.INVALID_INPUT) {
          return apiError(completion.error, HTTP_STATUS.BAD_REQUEST)
        }
        return apiError(
          'Error interno del servidor',
          HTTP_STATUS.INTERNAL_SERVER_ERROR
        )
      }

      return apiSuccess(
        {
          message: 'Créditos reclamados exitosamente',
          credits: completion.credits,
          transactionId,
          newBalance: completion.newBalance,
          available: completion.available,
          pending: completion.pending,
        },
        HTTP_STATUS.OK,
        { noCache: true }
      )
    } catch (error) {
      logger.error('Error en claim-verify:', error)
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
