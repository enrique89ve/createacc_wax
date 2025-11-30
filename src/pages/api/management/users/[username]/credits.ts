import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import { db } from '@/lib/database'
import {
  assertCanPerform,
  unauthorizedResponse,
} from '@/lib/admin/permissions-management'
import { creditsService } from '@/lib/credits-service'

/**
 * PATCH: Asignar créditos pendientes a un builder
 * Los créditos se agregan a pending_amount para que el builder los reclame
 * Usa creditsService para mantener consistencia
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
        return new Response(
          JSON.stringify({ error: 'Username no proporcionado' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      const data = await context.request.json()

      interface CreditsUpdateRequest {
        readonly amount?: number
      }

      const { amount } = data as CreditsUpdateRequest

      // Validar cantidad
      if (!amount || typeof amount !== 'number' || amount < 1) {
        return new Response(
          JSON.stringify({ error: 'La cantidad debe ser mayor a 0' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      if (amount > 10000) {
        return new Response(
          JSON.stringify({ error: 'La cantidad máxima es 10000 créditos' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Verificar que el builder existe
      const builderResult = await db.execute({
        sql: "SELECT id FROM Users WHERE username = ? AND role = 'builder'",
        args: [username.toLowerCase()],
      })

      if (builderResult.rows.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Builder no encontrado' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Usar creditsService para asignar créditos (mantiene consistencia)
      const updatedCredits = await creditsService.assignCredits({
        hive_username: username.toLowerCase(),
        amount,
        source: 'Panel admin - asignación manual',
        assigned_by_admin: session.userId,
      })

      return new Response(
        JSON.stringify({
          success: true,
          message: `${amount} créditos asignados exitosamente`,
          credits: {
            available: updatedCredits.available_amount,
            pending: updatedCredits.pending_amount,
            total_assigned: updatedCredits.total_assigned,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Error interno' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  })
}

/**
 * PUT: Ajustar créditos directamente (establecer valores absolutos)
 * Solo para admin - permite corregir valores de pending_amount y available_amount
 */
export const PUT: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Solo admin puede hacer ajustes directos
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
        return new Response(
          JSON.stringify({ error: 'Username no proporcionado' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      const data = await context.request.json()

      interface CreditsAdjustRequest {
        readonly pending_amount?: number
        readonly available_amount?: number
        readonly reason?: string
      }

      const { pending_amount, available_amount, reason } =
        data as CreditsAdjustRequest

      // Validar que al menos un valor se proporciona
      if (pending_amount === undefined && available_amount === undefined) {
        return new Response(
          JSON.stringify({
            error: 'Debe proporcionar pending_amount o available_amount',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Validar valores no negativos
      if (
        (pending_amount !== undefined &&
          (typeof pending_amount !== 'number' || pending_amount < 0)) ||
        (available_amount !== undefined &&
          (typeof available_amount !== 'number' || available_amount < 0))
      ) {
        return new Response(
          JSON.stringify({
            error: 'Los valores de créditos no pueden ser negativos',
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Límite máximo de seguridad
      if (
        (pending_amount !== undefined && pending_amount > 100000) ||
        (available_amount !== undefined && available_amount > 100000)
      ) {
        return new Response(
          JSON.stringify({ error: 'El valor máximo permitido es 100000' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Obtener builder ID
      const builderResult = await db.execute({
        sql: "SELECT id FROM Users WHERE username = ? AND role = 'builder'",
        args: [username.toLowerCase()],
      })

      if (builderResult.rows.length === 0) {
        return new Response(
          JSON.stringify({ error: 'Builder no encontrado' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      const builderId = Number(builderResult.rows[0]?.id)

      // Usar el servicio de créditos para hacer el ajuste
      const updatedCredits = await creditsService.adjustCredits({
        builder_id: builderId,
        pending_amount,
        available_amount,
        reason: reason || 'Ajuste manual por admin',
        performed_by_admin: session.userId,
      })

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Créditos ajustados exitosamente',
          credits: {
            available: updatedCredits.available_amount,
            pending: updatedCredits.pending_amount,
            total_assigned: updatedCredits.total_assigned,
            total_consumed: updatedCredits.total_consumed,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Error interno'
      return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  })
}
