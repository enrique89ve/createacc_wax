import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'

import {
  assertCanPerform,
  Permission,
  unauthorizedResponse,
} from '@/lib/auth/permissions'
import { creditsService } from '@/lib/credits-service'

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
  return typeof value === 'object' && value !== null
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
          total_assigned: updatedCredits.total_assigned,
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
  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Only admin can make direct adjustments
      try {
        assertCanPerform(
          session,
          Permission.ADMIN_ADJUSTMENTS,
          'PUT /api/management/users/[username]/credits'
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
      const pending_amount = body?.pending_amount
      const available_amount = body?.available_amount
      const reason = body?.reason

      // Validate that at least one value is provided
      if (pending_amount === undefined && available_amount === undefined) {
        return apiError(
          'Debe proporcionar pending_amount o available_amount',
          400
        )
      }

      // Validate non-negative values
      if (
        (pending_amount !== undefined &&
          !isSafeCreditAmount(pending_amount, 100000)) ||
        (available_amount !== undefined &&
          !isSafeCreditAmount(available_amount, 100000))
      ) {
        return apiError('Los valores de créditos no pueden ser negativos', 400)
      }

      if (
        reason !== undefined &&
        (typeof reason !== 'string' || reason.length > 500)
      ) {
        return apiError('La razón del ajuste no es válida', 400)
      }

      const updatedCredits = await creditsService.adjustCredits({
        hive_username: username.toLowerCase(),
        pending_amount,
        available_amount,
        reason:
          typeof reason === 'string' && reason.trim().length > 0
            ? reason.trim()
            : 'Ajuste manual por admin',
        performed_by_admin: session.username,
      })

      return apiSuccess({
        message: 'Créditos ajustados exitosamente',
        credits: {
          available: updatedCredits.available_amount,
          pending: updatedCredits.pending_amount,
          total_assigned: updatedCredits.total_assigned,
          total_consumed: updatedCredits.total_consumed,
        },
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error interno'
      return apiError(errorMessage, 500)
    }
  })
}
