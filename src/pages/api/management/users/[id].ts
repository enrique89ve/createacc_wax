import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import { db } from '@/lib/database'
import {
	assertCanPerform,
	unauthorizedResponse,
} from '@/lib/admin/permissions-management'

// PATCH: Actualizar builder (solo is_active)
export const PATCH: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(session, 'MANAGE_BUILDERS', 'PATCH /api/management/users/[id]')
      } catch {
        return unauthorizedResponse()
      }

      const { id } = context.params
      const builderId = Number(id)

      if (!Number.isInteger(builderId)) {
        return new Response(
          JSON.stringify({ error: 'ID de builder inválido' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      const data = await context.request.json()
      interface BuilderUpdateRequest {
        readonly is_active?: boolean
      }

      const { is_active } = data as BuilderUpdateRequest

      // Validar is_active
      if (typeof is_active !== 'boolean') {
        return new Response(
          JSON.stringify({ error: 'is_active debe ser booleano' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Verificar que el builder existe
      const builderResult = await db.execute({
        sql: 'SELECT id, hive_username FROM Builders WHERE id = ?',
        args: [builderId],
      })

      if (builderResult.rows.length === 0) {
        return new Response(JSON.stringify({ error: 'Builder no encontrado' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const builder = builderResult.rows[0] as any

      // Actualizar estado
      await db.execute({
        sql: 'UPDATE Builders SET is_active = ? WHERE id = ?',
        args: [is_active, builderId],
      })

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Builder actualizado exitosamente',
          user: {
            id: builderId,
            hive_username: builder.hive_username,
            is_active,
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

// DELETE: Eliminar usuario builder específico por ID
export const DELETE: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(session, 'DELETE_BUILDER', 'DELETE /api/management/users/[id]')
      } catch {
        return unauthorizedResponse()
      }

      const { id } = context.params
      const userId = Number(id)

      if (!Number.isInteger(userId)) {
        return new Response(
          JSON.stringify({ error: 'ID de usuario inválido' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Verificar que el builder existe
      const builderResult = await db.execute({
        sql: 'SELECT id, hive_username FROM Builders WHERE id = ?',
        args: [userId],
      })

      if (builderResult.rows.length === 0) {
        return new Response(JSON.stringify({ error: 'Builder no encontrado' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Eliminar builder
      await db.execute({
        sql: 'DELETE FROM Builders WHERE id = ?',
        args: [userId],
      })

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Usuario eliminado exitosamente',
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