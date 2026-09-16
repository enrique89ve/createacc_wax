import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import {
  assertCanPerform,
  Permission,
  unauthorizedResponse,
} from '@/lib/auth/permissions'
import { apiError } from '@/utils/errorResponse'

export const PATCH: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.MANAGE_CREDITS,
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
  return withAdminSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.MANAGE_CREDITS,
        'DELETE /api/management/users/[id]'
      )
    } catch {
      return unauthorizedResponse()
    }

    return apiError(
      'Los builders no se persisten. No hay registro de usuario que eliminar.',
      410
    )
  })
}
