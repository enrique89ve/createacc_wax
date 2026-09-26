import type { APIRoute } from 'astro'
import { ROUTES, HTTP_STATUS } from '@/consts/constants'
import { CreationSessionManager } from '@/lib/session-cookies'
import { apiError } from '@/utils/errorResponse'
import { signOutAdmin } from '@/lib/auth/admin-auth'
import { buildLogoutHeaders } from '@/utils/logout-helpers'
import { apiSuccess } from '@/utils/errorResponse'

async function clearCreationSession(context: Parameters<APIRoute>[0]) {
  try {
    const creationManager = new CreationSessionManager(
      context.cookies,
      context.request
    )
    creationManager.clear()
  } catch {
    // Non-critical cleanup
  }
}

export const GET: APIRoute = async context => {
  try {
    await signOutAdmin(context.request)
    await clearCreationSession(context)
    return context.redirect('/builders/login')
  } catch {
    return context.redirect('/builders/login')
  }
}

export const POST: APIRoute = async context => {
  try {
    await signOutAdmin(context.request)
    await clearCreationSession(context)

    context.locals.adminUser = undefined
    context.locals.creation = undefined
    context.locals.builderUser = undefined

    const headers = buildLogoutHeaders(context.request)
    return apiSuccess(
      {
        message: 'Sesión cerrada exitosamente',
        redirectTo: ROUTES.LOGIN,
      },
      HTTP_STATUS.OK,
      { headers }
    )
  } catch {
    return apiError(
      'Error durante el cierre de sesión',
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      undefined,
      { noCache: true }
    )
  }
}
