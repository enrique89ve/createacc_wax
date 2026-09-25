import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import {
  assertCanPerform,
  Permission,
  unauthorizedResponse,
} from '@/lib/auth/permissions'
import { unblockHiveUsername } from '@/lib/auth/blocked-hive-accounts'
import { apiError, apiSuccess } from '@/utils/errorResponse'
import { requireValidOrigin } from '@/utils/csrf-protection'

export const POST: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withAdminApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.REACTIVATE_BUILDER,
        'POST /api/management/users/[id]/reactivate'
      )
    } catch {
      return unauthorizedResponse()
    }

    const username = context.params.id
    if (!username) {
      return apiError('Username Hive inválido', 400)
    }

    const hiveUsername = await unblockHiveUsername(username)
    if (!hiveUsername) {
      return apiError('Ese username no está bloqueado', 404)
    }

    return apiSuccess({
      message: `Username @${hiveUsername} reactivado`,
      hive_username: hiveUsername,
    })
  })
}
