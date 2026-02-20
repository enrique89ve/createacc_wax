import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import { db } from '@/lib/database'
import {
	assertCanPerform,
	unauthorizedResponse,
} from '@/lib/admin/permissions-management'
import { apiSuccess, apiError } from '@/utils/errorResponse'

/** Partial row from SELECT id, username */
interface BuilderIdRow {
	readonly id: number
	readonly username: string
}

// PATCH: Update builder (is_active only)
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
        return apiError('ID de builder inválido', 400)
      }

      const data = await context.request.json()
      interface BuilderUpdateRequest {
        readonly is_active?: boolean
      }

      const { is_active } = data as BuilderUpdateRequest

      // Validate is_active
      if (typeof is_active !== 'boolean') {
        return apiError('is_active debe ser booleano', 400)
      }

      // Verify that the builder exists
      const builderResult = await db.execute({
        sql: 'SELECT id, username FROM Users WHERE id = ? AND role = \'builder\'',
        args: [builderId],
      })

      if (builderResult.rows.length === 0) {
        return apiError('Builder no encontrado', 404)
      }

      const builder = builderResult.rows[0] as unknown as BuilderIdRow

      // Update status
      await db.execute({
        sql: 'UPDATE Users SET is_active = ? WHERE id = ? AND role = \'builder\'',
        args: [is_active, builderId],
      })

      return apiSuccess({
        message: 'Builder actualizado exitosamente',
        user: {
          id: builderId,
          hive_username: builder.username,
          is_active,
        },
      })
    } catch (error) {
      return apiError('Error interno', 500)
    }
  })
}

// DELETE: Delete specific builder user by ID
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
        return apiError('ID de usuario inválido', 400)
      }

      // Verify that the builder exists
      const builderResult = await db.execute({
        sql: 'SELECT id, username FROM Users WHERE id = ? AND role = \'builder\'',
        args: [userId],
      })

      if (builderResult.rows.length === 0) {
        return apiError('Builder no encontrado', 404)
      }

      // Delete builder
      await db.execute({
        sql: 'DELETE FROM Users WHERE id = ? AND role = \'builder\'',
        args: [userId],
      })

      return apiSuccess({
        message: 'Usuario eliminado exitosamente',
      })
    } catch (error) {
      return apiError('Error interno', 500)
    }
  })
}