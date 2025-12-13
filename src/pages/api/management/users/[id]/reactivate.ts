import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import { usersRepository } from '@/lib/repositories/users-repository'
import {
  assertCanPerform,
  unauthorizedResponse,
} from '@/lib/admin/permissions-management'
import { UserRole } from '@/lib/roles'

/**
 * POST: Reactivar un builder previamente baneado
 */
export const POST: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Solo admins pueden reactivar builders
      try {
        assertCanPerform(
          session,
          'MANAGE_BUILDERS',
          'POST /api/management/users/[id]/reactivate'
        )
      } catch {
        return unauthorizedResponse()
      }

      const { id } = context.params

      if (!id || isNaN(Number(id))) {
        return new Response(
          JSON.stringify({ error: 'ID de builder inválido' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      const builderId = Number(id)

      // Verificar que el builder existe y está inactivo
      const builder = await usersRepository.getById(builderId)

      if (!builder) {
        return new Response(
          JSON.stringify({ error: 'Builder no encontrado' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      if (builder.role !== UserRole.Builder) {
        return new Response(
          JSON.stringify({ error: 'El usuario no es un builder' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      if (builder.is_active) {
        return new Response(
          JSON.stringify({ error: 'El builder ya está activo' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      }

      // Reactivar el builder
      await usersRepository.reactivateBuilder(builderId)

      return new Response(
        JSON.stringify({
          success: true,
          message: `Builder @${builder.username} reactivado exitosamente`,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } catch (error) {
      console.error('Error reactivating builder:', error)
      return new Response(
        JSON.stringify({ error: 'Error interno al reactivar builder' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }
  })
}
