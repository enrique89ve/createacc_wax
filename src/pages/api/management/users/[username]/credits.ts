import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import { db } from '@/lib/database'
import {
  assertCanPerform,
  unauthorizedResponse,
} from '@/lib/admin/permissions-management'
import { creditsService } from '@/lib/credits-service'
import { UserRole } from '@/lib/roles'
import { apiSuccess, apiError } from '@/utils/errorResponse'

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
          'ASSIGN_CREDITS',
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

      interface CreditsUpdateRequest {
        readonly amount?: number
      }

      const { amount } = data as CreditsUpdateRequest

      // Validate amount
      if (!amount || typeof amount !== 'number' || amount < 1) {
        return apiError('La cantidad debe ser mayor a 0', 400)
      }

      if (amount > 10000) {
        return apiError('La cantidad máxima es 10000 créditos', 400)
      }

      // Verify that the builder exists
      const builderResult = await db.execute({
        sql: `SELECT id FROM "user" WHERE username = ? AND role = ?`,
        args: [username.toLowerCase(), UserRole.Builder],
      })

      if (builderResult.rows.length === 0) {
        return apiError('Builder no encontrado', 404)
      }

      // Use creditsService to assign credits (maintains consistency)
      const updatedCredits = await creditsService.assignCredits({
        hive_username: username.toLowerCase(),
        amount,
        source: 'Panel admin - asignación manual',
        assigned_by_admin: session.userId,
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
          'MANAGE_ALL_CREDITS',
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

      interface CreditsAdjustRequest {
        readonly pending_amount?: number
        readonly available_amount?: number
        readonly reason?: string
      }

      const { pending_amount, available_amount, reason } =
        data as CreditsAdjustRequest

      // Validate that at least one value is provided
      if (pending_amount === undefined && available_amount === undefined) {
        return apiError('Debe proporcionar pending_amount o available_amount', 400)
      }

      // Validate non-negative values
      if (
        (pending_amount !== undefined &&
          (typeof pending_amount !== 'number' || pending_amount < 0)) ||
        (available_amount !== undefined &&
          (typeof available_amount !== 'number' || available_amount < 0))
      ) {
        return apiError('Los valores de créditos no pueden ser negativos', 400)
      }

      // Maximum security limit
      if (
        (pending_amount !== undefined && pending_amount > 100000) ||
        (available_amount !== undefined && available_amount > 100000)
      ) {
        return apiError('El valor máximo permitido es 100000', 400)
      }

      // Get builder ID
      const builderResult = await db.execute({
        sql: `SELECT id FROM "user" WHERE username = ? AND role = ?`,
        args: [username.toLowerCase(), UserRole.Builder],
      })

      if (builderResult.rows.length === 0) {
        return apiError('Builder no encontrado', 404)
      }

      const builderId = String(builderResult.rows[0]?.id)

      // Use the credits service to make the adjustment
      const updatedCredits = await creditsService.adjustCredits({
        builder_id: builderId,
        pending_amount,
        available_amount,
        reason: reason || 'Ajuste manual por admin',
        performed_by_admin: session.userId,
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
