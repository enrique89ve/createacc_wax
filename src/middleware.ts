import { defineMiddleware } from 'astro:middleware'
// Side-effect: instala hooks para normalizar valores no-Error lanzados
import '@/lib/error-normalizer'
import { ROUTES } from '@/consts/constants'
import { CreationSessionManager } from '@/lib/session-manager'
import { requireAdminAuth } from '@/lib/admin/auth/helpers/auth-guards'
import type { APIContext } from 'astro'
import type { AdminSession } from '@/types/auth'

/**
 * Route protection configuration
 */
const PROTECTED_ROUTES = {
  MANAGEMENT_PREFIX: ROUTES.MANAGEMENT,
  LOGIN_PATH: ROUTES.LOGIN,
  CONSOLE_REDIRECT: ROUTES.CONSOLE,
} as const

/**
 * Check if a path requires authentication
 */
function isProtectedRoute(pathname: string): boolean {
  return pathname.startsWith(PROTECTED_ROUTES.MANAGEMENT_PREFIX)
}

/**
 * Check if path is the login page
 */
function isLoginPage(pathname: string): boolean {
  return pathname === PROTECTED_ROUTES.LOGIN_PATH
}

/**
 * Convierte el resultado del guard al formato legacy esperado en la app
 * Maneja usuarios temporales (ID 0) rechazándolos para evitar acceso no autorizado
 */
function mapGuardResultToAdmin(guardResult: any): AdminSession {
  const rawId = guardResult.id ?? ''
  const userId = Number.parseInt(rawId, 10)

  // Usuarios temporales (ID 0) no deben acceder a management
  if (Number.isNaN(userId) || userId === 0) {
    throw new Error(
    )
  }

  // Type-safe role mapping
  const sessionRole = guardResult.role
  const role: 'admin' | 'builder' = sessionRole === 'admin' ? 'admin' : 'builder'

  return {
    userId,
    username: guardResult.username || '',
    role,
    loginTime: new Date(guardResult.loginTime).toISOString(),
  }
}

/**
 * Protege rutas bajo /management usando los auth guards simplificados
 */
async function protectManagementRoutes(
  context: APIContext
): Promise<Response | null> {
  const { pathname } = context.url

  if (!isProtectedRoute(pathname)) {
    return null
  }

  // Handle login page - redirect if already authenticated
  if (isLoginPage(pathname)) {
    const authResult = await requireAdminAuth(context.request)
    if (authResult.isAuthenticated) {
      return context.redirect(PROTECTED_ROUTES.CONSOLE_REDIRECT)
    }
    return null
  }

  // Check authentication for protected routes
  const authResult = await requireAdminAuth(context.request)

  if (!authResult.isAuthenticated) {
    return context.redirect(
      authResult.redirectTo || PROTECTED_ROUTES.LOGIN_PATH
    )
  }

  // Set user in locals for compatibility
  try {
    if (authResult.user) {
      context.locals.adminUser = mapGuardResultToAdmin(authResult.user)
    }
  } catch (error) {
    return context.redirect(PROTECTED_ROUTES.LOGIN_PATH)
  }

  return null
}

/**
 * Cargar sessions disponibles en locals para todas las páginas
 */
async function loadCreationSession(context: APIContext): Promise<void> {
  try {
    if (context.locals.creation !== undefined) return
    const creation = await new CreationSessionManager(context).get()
    if (creation) context.locals.creation = creation
  } catch (error) {
    // Silently fail - session will be undefined
  }
}

/**
 * Main middleware handler with full TypeScript support
 * Handles route protection and session management using error chain
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next()

  try {
    const protectionResult = await protectManagementRoutes(context)
    if (protectionResult) return protectionResult

    await loadCreationSession(context)
  } catch (error) {
    // Silently handle middleware errors
  }

  return next()
})
