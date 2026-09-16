import type { APIRoute } from 'astro'
import { ROUTES, HTTP_STATUS } from '@/consts/constants'
import { CreationSessionManager } from '@/lib/session-cookies'
import { apiError } from '@/utils/errorResponse'
import { signOutAuth } from '@/lib/auth-session'
import { buildLogoutHeaders } from '@/utils/logout-helpers'

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
    await signOutAuth(context.request)
    await clearCreationSession(context)
    return context.redirect('/builders/login')
  } catch {
    return context.redirect('/builders/login')
  }
}

export const POST: APIRoute = async context => {
  try {
    await signOutAuth(context.request)
    await clearCreationSession(context)

    context.locals.adminUser = undefined
    context.locals.creation = undefined
    context.locals.builderUser = undefined

    const headers = buildLogoutHeaders(context.request)
    headers.set('Cache-Control', 'no-store')
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Sesión cerrada exitosamente',
        redirectTo: ROUTES.LOGIN,
      }),
      { status: HTTP_STATUS.OK, headers }
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
