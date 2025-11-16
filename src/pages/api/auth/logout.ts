import type { APIRoute } from 'astro'
import { ROUTES, HTTP_STATUS } from '@/consts/constants'
// Logger removed
import { CreationSessionManager } from '@/lib/session-manager'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

async function signOutViaAuth(
  context: Parameters<APIRoute>[0]
): Promise<Response> {
  const authUrl = new URL('/api/auth/signout', context.url.origin)
  return fetch(authUrl.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: context.request.headers.get('cookie') ?? '',
    },
    body: new URLSearchParams({ redirect: 'false' }),
  })
}

async function clearCreationSession(context: Parameters<APIRoute>[0]) {
  try {
    const creationManager = new CreationSessionManager(context)
    await creationManager.clear()
  } catch (error) {
    // Silently handle cleanup errors
  }
}

export const GET: APIRoute = async context => {
  try {
    // Audit log removed - session destruction tracked by Auth.js
    await signOutViaAuth(context)
    // Auth.js handles cookie clearing automatically
    await clearCreationSession(context)

    return context.redirect('/builders/login')
  } catch (error) {
    return context.redirect('/builders/login')
  }
}

export const POST: APIRoute = async context => {
  try {
    // Audit log removed - session destruction tracked by Auth.js
    await signOutViaAuth(context)
    // Auth.js handles cookie clearing automatically
    await clearCreationSession(context)

    context.locals.adminUser = undefined
    context.locals.user = undefined
    context.locals.creation = undefined

    return json(
      {
        success: true,
        message: 'Sesión cerrada exitosamente',
        redirectTo: ROUTES.LOGIN,
      },
      HTTP_STATUS.OK
    )
  } catch (error) {
    return json(
      { success: false, error: 'Error durante el cierre de sesión' },
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
