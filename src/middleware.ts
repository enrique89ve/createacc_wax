import { defineMiddleware } from 'astro:middleware'
// Side-effect: instala hooks para normalizar valores no-Error lanzados
import '@/lib/error-normalizer'
import { ROUTES } from '@/consts/constants'
import { CreationSessionManager } from '@/lib/session-manager'
import {
  requireAdminAuth,
  requireBuildersAuth,
} from '@/lib/admin/auth/helpers/auth-guards'
import type { APIContext } from 'astro'
import type { AdminSession } from '@/types/auth'
import { parseRole } from '@/lib/roles'
import { getBooleanEnv } from '@/lib/env'

/**
 * Route protection configuration
 */
const PROTECTED_ROUTES = {
  MANAGEMENT_PREFIX: ROUTES.MANAGEMENT,
  LOGIN_PATH: ROUTES.LOGIN,
  CONSOLE_REDIRECT: ROUTES.CONSOLE,
  BUILDERS_PREFIX: '/builders/',
  BUILDERS_LOGIN_PATH: ROUTES.BUILDERS_LOGIN,
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
 * Validates role strictly - does NOT assume unknown roles are 'builder'
 */
function mapGuardResultToAdmin(guardResult: any): AdminSession {
  const rawId = guardResult.id ?? ''
  const userId = Number.parseInt(rawId, 10)

  // Usuarios temporales (ID 0) no deben acceder a management
  if (Number.isNaN(userId) || userId === 0) {
    throw new Error('Invalid user ID: temporary users cannot access management')
  }

  // Validate role strictly - reject if not a valid UserRole
  const role = parseRole(guardResult.role)
  if (!role) {
    throw new Error(`Invalid role: ${guardResult.role}`)
  }

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
 * Protege rutas bajo /builders usando los auth guards
 */
async function protectBuildersRoutes(
  context: APIContext
): Promise<Response | null> {
  const { pathname } = context.url

  // Only check builders routes
  if (!pathname.startsWith(PROTECTED_ROUTES.BUILDERS_PREFIX)) {
    return null
  }

  // Handle login page - redirect if already authenticated
  if (pathname === PROTECTED_ROUTES.BUILDERS_LOGIN_PATH) {
    const authResult = await requireBuildersAuth(context.request)
    if (authResult.isAuthenticated) {
      return context.redirect('/builders/accounts')
    }
    return null
  }

  // Check authentication for protected routes
  const authResult = await requireBuildersAuth(context.request)

  if (!authResult.isAuthenticated) {
    return context.redirect(
      authResult.redirectTo || PROTECTED_ROUTES.BUILDERS_LOGIN_PATH
    )
  }

  return null
}

/**
 * Cargar sessions disponibles en locals para todas las páginas
 */
async function loadCreationSession(context: APIContext): Promise<void> {
  try {
    if (context.locals.creation !== undefined) return
    const creation = new CreationSessionManager(
      context.cookies,
      context.request
    ).get()
    if (creation) context.locals.creation = creation
  } catch (error) {
    // Silently fail - session will be undefined
  }
}

/**
 * Build CSP connect-src: include testnet API only in development.
 * 'unsafe-inline' is required by Astro (no experimental CSP with ClientRouter).
 */
function buildConnectSrc(): string {
  const sources = [
    "'self'",
    'https://api.hive.blog',
    'https://api.openhive.network',
    'https://techcoderx.com',
    'https://rpc.mahdiyari.info',
  ]
  if (!getBooleanEnv('MAINNET')) {
    sources.push('https://api.fake.openhive.network')
  }
  return `connect-src ${sources.join(' ')}`
}

/**
 * Security headers applied to all responses.
 * CSP allows inline scripts/styles (required by Astro) and WASM for @hiveio/wax.
 *
 * ACCEPTED RISK: 'unsafe-inline' in script-src weakens XSS protection.
 * Astro does not support nonce-based CSP without experimental ClientRouter.
 * Mitigated by: never reflecting user input via innerHTML (textContent only),
 * strict input validation, and frame-ancestors 'none'.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    buildConnectSrc(),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
}

function applySecurityHeaders(response: Response): Response {
  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(header, value)
  }
  return response
}

/**
 * Main middleware handler with full TypeScript support
 * Handles route protection, session management, and security headers
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next()

  try {
    const protectionResult = await protectManagementRoutes(context)
    if (protectionResult) return applySecurityHeaders(protectionResult)

    const buildersProtectionResult = await protectBuildersRoutes(context)
    if (buildersProtectionResult) return applySecurityHeaders(buildersProtectionResult)

    await loadCreationSession(context)
  } catch (error) {
    // E3 fix: log middleware errors instead of silencing them
    const errorMessage = error instanceof Error ? error.message : 'Unknown middleware error'
    console.warn(`[middleware] Auth/session error: ${errorMessage}`)
  }

  const response = await next()
  return applySecurityHeaders(response)
})
