import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import {
  assertCanPerform,
  Permission,
  unauthorizedResponse,
} from '@/lib/auth/permissions'
import { blockHiveUsername } from '@/lib/auth/blocked-hive-accounts'
import { apiError, apiSuccess } from '@/utils/errorResponse'
import { requireValidOrigin } from '@/utils/csrf-protection'

export const PATCH: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.VIEW_BUILDERS,
        'PATCH /api/management/users/[id]'
      )
    } catch {
      return unauthorizedResponse()
    }

    return apiError(
      'Los builders no se persisten. Usa asignación de créditos por username.',
      410
    )
  })
}

export const DELETE: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withAdminSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.BLOCK_BUILDER,
        'DELETE /api/management/users/[id]'
      )
    } catch {
      return unauthorizedResponse()
    }

    const username = context.params.id
    if (!username) {
      return apiError('Username Hive inválido', 400)
    }

    try {
      const hiveUsername = await blockHiveUsername({
        hiveUsername: username,
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
