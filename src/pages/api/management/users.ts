import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import { usersRepository } from '@/lib/repositories/users-repository'
import { creditsService } from '@/lib/credits-service'
import { assertCanPerform, unauthorizedResponse } from '@/lib/auth/permissions'
import { CREDITS_LIMITS } from '@/consts/constants'
import { requireValidOrigin } from '@/utils/csrf-protection'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { Permission } from '@/lib/auth/permissions'
import { blockHiveUsername } from '@/lib/auth/blocked-hive-accounts'

// GET: List builder users
export const GET: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      // RBAC: Check permission
      try {
        assertCanPerform(
          session,
          Permission.VIEW_BUILDERS,
          'GET /api/management/users'
        )
      } catch {
        return unauthorizedResponse()
      }

      // Get all builders using the unified repository
      const builders = await usersRepository.getAllBuilders()

      const accounts = builders.map(builder => ({
        hive_username: builder.hive_username,
        created_at: builder.created_at,
        tickets_created: builder.tickets_created,
        available_credits: builder.available_credits,
        pending_credits: builder.pending_credits,
        credit_revision: builder.credit_revision,
        is_blocked: builder.is_blocked,
      }))

      return apiSuccess({ accounts })
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
          Permission.ASSIGN_CREDITS,
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
          return apiError(
            `El máximo de créditos permitido es ${CREDITS_LIMITS.MAX_ASSIGNMENT}`,
            400
          )
        }
        initialCredits = amount
      }

      await creditsService.assignCredits({
        hive_username: cleanUsername,
        amount: initialCredits,
        source: 'Créditos iniciales',
        assigned_by_admin: session.username,
      })

      return apiSuccess(
        {
          message: 'Créditos asignados al username Hive',
          account: {
            hive_username: cleanUsername,
            initial_credits: initialCredits,
          },
        },
        201
      )
    } catch (error) {
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
          Permission.BLOCK_BUILDER,
          'DELETE /api/management/users'
        )
      } catch {
        return unauthorizedResponse()
      }

      const url = new URL(context.request.url)
      const userId = url.searchParams.get('id')

      if (!userId) {
        return apiError('Username Hive inválido', 400)
      }

      const hiveUsername = await blockHiveUsername({
        hiveUsername: userId,
        blockedBy: session.username,
        reason: 'abuse',
      })

      return apiSuccess({
        message: `Username @${hiveUsername} bloqueado por abuso`,
        hive_username: hiveUsername,
      })
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('at least 3 characters')
      ) {
        return apiError('Username Hive inválido', 400)
      }
      return apiError('Error interno', 500)
    }
  })
}
