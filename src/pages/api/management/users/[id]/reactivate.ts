import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import {
  assertCanPerform,
  Permission,
  unauthorizedResponse,
} from '@/lib/auth/permissions'
import { apiError } from '@/utils/errorResponse'

export const POST: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.MANAGE_CREDITS,
        'POST /api/management/users/[id]/reactivate'
      )
    } catch {
      return unauthorizedResponse()
    }

    return apiError(
      'Los builders no se persisten. No hay estado de activación.',
      410
    )
  })
}
