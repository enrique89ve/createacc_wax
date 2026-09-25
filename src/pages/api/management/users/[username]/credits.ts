import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import { getFreshAdminSession } from '@/lib/auth/admin-auth'
import {
  AdminMutationError,
  adjustBuilderCredits,
  parseAdminCreditAdjustmentInput,
} from '@/lib/admin-mutations'

import {
  assertCanPerform,
  Permission,
  unauthorizedResponse,
} from '@/lib/auth/permissions'
import { creditsService } from '@/lib/credits-service'
import { logger } from '@/lib/logger'
import { requireValidOrigin } from '@/utils/csrf-protection'

import { apiSuccess, apiError } from '@/utils/errorResponse'

function isSafeCreditAmount(value: unknown, maximum: number): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * PATCH: Assign pending credits to a builder
 * Credits are added to pending_amount for the builder to claim
 * Uses creditsService to maintain consistency
 */
export const PATCH: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(
          session,
          Permission.ASSIGN_CREDITS,
          'PATCH /api/management/users/[username]/credits'
        )
      } catch {
        return unauthorizedResponse()
      }

      const { username } = context.params

      if (!username) {
        return apiError('Username no proporcionado', 400)
      }

      const data = await context.request.json()

      const body = asRecord(data)
      const amount = body?.amount

      // Validate amount
      if (!isSafeCreditAmount(amount, 10000) || amount < 1) {
        return apiError('La cantidad debe ser mayor a 0', 400)
      }

      const updatedCredits = await creditsService.assignCredits({
        hive_username: username.toLowerCase(),
        amount,
        source: 'Panel admin - asignación manual',
        assigned_by_admin: session.username,
      })

      return apiSuccess({
        message: `${amount} créditos asignados exitosamente`,
        credits: {
          available: updatedCredits.available_amount,
          pending: updatedCredits.pending_amount,
          total_issued: updatedCredits.total_issued,
        },
      })
    } catch (error) {
      return apiError('Error interno', 500)
    }
  })
}

/**
 * PUT: Adjust credits directly (set absolute values)
 * Admin only - allows correcting pending_amount and available_amount values
 */
export const PUT: APIRoute = async context => {
  const originFailure = requireValidOrigin(context.request)
  if (originFailure) return originFailure

  const sessionResult = await getFreshAdminSession(context.request)
  if (sessionResult.kind === 'unauthenticated') {
    return apiError('Se requiere una sesión de administrador activa', 401, {
      code: 'UNAUTHENTICATED',
    })
  }
  if (sessionResult.kind === 'unavailable') {
    return apiError('No se pudo verificar la sesión', 503, {
      code: 'AUTH_SESSION_UNAVAILABLE',
    })
  }

  let requestBody: unknown
  try {
    requestBody = await context.request.json()
  } catch {
    return apiError('El cuerpo debe contener JSON válido', 400, {
      code: 'INVALID_COMMAND',
    })
  }
  const parsed = parseAdminCreditAdjustmentInput(
    context.params.username,
    requestBody
  )
  if (!parsed.ok) {
    return apiError(parsed.message, 400, { code: parsed.code })
  }

  try {
    const result = await adjustBuilderCredits(
      sessionResult.session,
      parsed.input
    )
    return apiSuccess(
      {
        disposition: result.disposition,
        action_log_id: result.actionLogId,
        credits: result.credits,
      },
      200,
      { noCache: true }
    )
  } catch (error) {
    if (error instanceof AdminMutationError) {
      return apiError(
        error.message,
        error.status,
        { code: error.code },
        { noCache: true }
      )
    }
    logger.error('Admin credit adjustment failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return apiError(
      'Error interno',
      500,
      { code: 'INTERNAL_ERROR' },
      { noCache: true }
    )
  }
}
