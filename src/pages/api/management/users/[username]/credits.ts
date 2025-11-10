import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import { db } from '@/lib/database'
import {
	assertCanPerform,
	unauthorizedResponse,
} from '@/lib/admin/permissions-management'

/**
 * PATCH: Asignar créditos pendientes a un builder
 * Los créditos se agregan a pending_amount para que el builder los reclame
 */
export const PATCH: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(session, 'ASSIGN_CREDITS', 'PATCH /api/management/users/[username]/credits')
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
        sql: 'SELECT id FROM Builders WHERE hive_username = ?',
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

      const builderId = builderResult.rows[0]?.id

      // Actualizar créditos pendientes
      await db.execute({
        sql: `UPDATE Credits
              SET pending_amount = pending_amount + ?,
                  total_assigned = total_assigned + ?
              WHERE builder_id = ?`,
        args: [amount, amount, builderId],
      })

      // Registrar en auditoría
      await db.execute({
        sql: `INSERT INTO CreditAudit (builder_id, operation, amount, reason, performed_by_admin)
              VALUES (?, 'assign', ?, 'Créditos asignados por admin', ?)`,
        args: [builderId, amount, session.userId],
      })

      // Obtener nuevos totales
      const creditsResult = await db.execute({
        sql: 'SELECT available_amount, pending_amount, total_assigned FROM Credits WHERE builder_id = ?',
        args: [builderId],
      })

      const credits = creditsResult.rows[0]

      return new Response(
        JSON.stringify({
          success: true,
          message: `${amount} créditos asignados exitosamente`,
          credits: {
            available: credits?.available_amount || 0,
            pending: credits?.pending_amount || 0,
            total_assigned: credits?.total_assigned || 0,
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
