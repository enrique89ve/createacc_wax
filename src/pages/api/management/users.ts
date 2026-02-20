import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import { usersRepository } from '@/lib/repositories/users-repository'
import { creditsService } from '@/lib/credits-service'
import {
  assertCanPerform,
  unauthorizedResponse,
} from '@/lib/admin/permissions-management'
import { CREDITS_LIMITS } from '@/consts/constants'
import { UserRole } from '@/lib/roles'
import { requireValidOrigin } from '@/utils/csrf-protection'
import { apiSuccess, apiError } from '@/utils/errorResponse'

// GET: List builder users
export const GET: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(
          session,
          'MANAGE_BUILDERS',
          'GET /api/management/users'
        )
      } catch {
        return unauthorizedResponse()
      }

      // Get all builders using the unified repository
      const builders = await usersRepository.getAllBuilders()

      const users = builders.map(builder => ({
        id: builder.id,
        username: builder.hive_username,
        role: UserRole.Builder,
        is_active: builder.is_active,
        last_claim_at: builder.last_claim_at,
        created_at: builder.created_at,
      }))

      return apiSuccess({ users })
    } catch (error) {
      return apiError('Error interno', 500)
    }
  })
}

// POST: Create new builder user
export const POST: APIRoute = async context => {
  // CSRF Protection
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(
          session,
          'CREATE_BUILDER',
          'POST /api/management/users'
        )
      } catch {
        return unauthorizedResponse()
      }

      const data = await context.request.json()
      interface BuilderCreateRequest {
        readonly hive_username?: string
      }

      const { hive_username, amount } = data as BuilderCreateRequest & {
        amount?: number
      }

      if (!hive_username || hive_username.length < 3) {
        return apiError('Hive username debe tener al menos 3 caracteres', 400)
      }

      const cleanUsername = hive_username.trim().toLowerCase()

      // Validate credit limits
      let initialCredits = 100 // default value
      if (typeof amount === 'number' && amount > 0) {
        if (amount > CREDITS_LIMITS.MAX_ASSIGNMENT) {
          return apiError(`El máximo de créditos permitido es ${CREDITS_LIMITS.MAX_ASSIGNMENT}`, 400)
        }
        initialCredits = amount
      }

      // Verify that the builder does not exist using the unified repository
      const exists =
        await usersRepository.builderExistsByUsername(cleanUsername)

      if (exists) {
        return apiError('El builder ya existe', 400)
      }

      // Create builder using the unified repository
      const newUser = await usersRepository.create({
        username: cleanUsername,
        role: UserRole.Builder,
        is_active: true,
      })

      const builderId = newUser.id

      // Assign initial credits using the creditsService
      await creditsService.assignCredits({
        hive_username: cleanUsername,
        amount: initialCredits,
        source: 'Créditos iniciales al crear builder',
        assigned_by_admin: session.userId,
      })

      return apiSuccess({
        message: 'Builder creado exitosamente con 100 créditos pendientes',
        user: {
          id: builderId,
          hive_username: cleanUsername,
          role: UserRole.Builder,
          initial_credits: 100,
        },
      }, 201)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        return apiError('El builder ya existe', 400)
      }

      return apiError('Error interno', 500)
    }
  })
}

// DELETE: Delete builder user
export const DELETE: APIRoute = async context => {
  // CSRF Protection
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(
          session,
          'DELETE_BUILDER',
          'DELETE /api/management/users'
        )
      } catch {
        return unauthorizedResponse()
      }

      const url = new URL(context.request.url)
      const userId = url.searchParams.get('id')
      const parsedId = Number(userId)

      // Strict validation: must be a positive integer and within safe range
      if (
        !userId ||
        !Number.isInteger(parsedId) ||
        parsedId <= 0 ||
        parsedId > Number.MAX_SAFE_INTEGER
      ) {
        return apiError('ID de usuario inválido', 400)
      }

      // Verify that the builder exists using the unified repository
      const user = await usersRepository.findById(parsedId)

      if (!user || user.role !== UserRole.Builder) {
        return apiError('Builder no encontrado', 404)
      }

      // Delete builder and cleanup dependencies
      await usersRepository.deleteBuilderWithReferences(parsedId)

      return apiSuccess({
        message: 'Usuario eliminado exitosamente',
      })
    } catch (error) {
      return apiError('Error interno', 500)
    }
  })
}
