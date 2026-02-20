import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { withAdminApiSession } from '@/lib/session-helpers'
import { usersRepository } from '@/lib/repositories/users-repository'
import {
  assertCanPerform,
  unauthorizedResponse,
} from '@/lib/admin/permissions-management'
import { UserRole } from '@/lib/roles'
import { apiSuccess, apiError } from '@/utils/errorResponse'

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
        return apiError('ID de builder inválido', 400)
      }

      const builderId = Number(id)

      // Verificar que el builder existe y está inactivo
      const builder = await usersRepository.getById(builderId)

      if (!builder) {
        return apiError('Builder no encontrado', 404)
      }

      if (builder.role !== UserRole.Builder) {
        return apiError('El usuario no es un builder', 400)
      }

      if (builder.is_active) {
        return apiError('El builder ya está activo', 400)
      }

      // Reactivar el builder
      await usersRepository.reactivateBuilder(builderId)

      return apiSuccess({
        message: `Builder @${builder.username} reactivado exitosamente`,
      })
    } catch (error) {
      logger.error('Error reactivating builder:', error)
      return apiError('Error interno al reactivar builder', 500)
    }
  })
}
