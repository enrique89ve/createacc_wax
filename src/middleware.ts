import { defineMiddleware, sequence } from 'astro:middleware'
// Side-effect: instala hooks para normalizar valores no-Error lanzados
import '@/lib/error-normalizer'
// Side-effect: starts auto-reconciler interval (idempotent — safe to import from multiple sites)
import '@/lib/auto-reconciler'
import { HIVE_CHAIN_CONFIG, ROUTES } from '@/consts/constants'
import { CreationSessionManager } from '@/lib/session-cookies'
import { getAdminSession } from '@/lib/auth/admin-auth'
import {
  clearBuilderSessionCookie,
  getBuilderSessionCookie,
} from '@/lib/auth/builder-session'
import { isHiveUsernameBlocked } from '@/lib/auth/blocked-hive-accounts'
import type { APIContext } from 'astro'
import { logger } from '@/lib/logger'

async function protectManagementRoutes(
  context: APIContext
): Promise<Response | null> {
  const { pathname } = context.url

  if (!pathname.startsWith(ROUTES.MANAGEMENT)) {
    return null
  }

  const session = await getAdminSession(context.request)

  if (pathname === ROUTES.LOGIN) {
    if (session) {
      return context.redirect(ROUTES.CONSOLE)
    }
    return null
  }

  if (!session) {
    return context.redirect(ROUTES.LOGIN)
  }

  context.locals.adminUser = session
  return null
}

async function protectBuildersRoutes(
  context: APIContext
): Promise<Response | null> {
  const { pathname } = context.url

  if (!pathname.startsWith(ROUTES.BUILDERS_PREFIX)) {
    return null
  }

  const session = getBuilderSessionCookie(context.cookies)

  if (session && (await isHiveUsernameBlocked(session.username))) {
    clearBuilderSessionCookie(context.cookies)
    if (pathname === ROUTES.BUILDERS_LOGIN) {
      return null
    }
    return context.redirect(ROUTES.BUILDERS_LOGIN)
  }

  if (pathname === ROUTES.BUILDERS_LOGIN) {
    if (session) {
      return context.redirect(ROUTES.BUILDERS_DASHBOARD)
    }
    return null
  }

  if (!session) {
    return context.redirect(ROUTES.BUILDERS_LOGIN)
  }

  context.locals.builderUser = session
  return null
}

async function loadCreationSession(context: APIContext): Promise<void> {
  try {
    if (context.locals.creation !== undefined) return
    const creation = new CreationSessionManager(
      context.cookies,
      context.request
    ).get()
    if (creation) context.locals.creation = creation
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    logger.warn(`[middleware] Creation session load error: ${errorMessage}`)
  }
}

function hiveConnectSources(): string[] {
  return [
    HIVE_CHAIN_CONFIG.MAINNET_DEFAULT,
    ...HIVE_CHAIN_CONFIG.MAINNET_BACKUPS,
  ]
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
function buildSecurityHeaders(): Record<string, string> {
  const connectSrc = ["'self'", ...hiveConnectSources()].join(' ')
  return {
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
      `connect-src ${connectSrc}`,
      "object-src 'none'",
      "script-src-attr 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  }
}

function isKeyCeremonyPath(pathname: string): boolean {
  return pathname.startsWith(ROUTES.DETAILS_PREFIX)
}

function buildKeyCeremonySecurityHeaders(): Record<string, string> {
  const headers = buildSecurityHeaders()
  const connectSrc = ["'self'", ...hiveConnectSources()].join(' ')
  headers['Content-Security-Policy'] = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "script-src-attr 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  headers['Referrer-Policy'] = 'no-referrer'
  return headers
}

const SECURITY_HEADERS = buildSecurityHeaders()
const KEY_CEREMONY_SECURITY_HEADERS = buildKeyCeremonySecurityHeaders()

function applySecurityHeaders(response: Response, pathname = ''): Response {
  const headers = isKeyCeremonyPath(pathname)
    ? KEY_CEREMONY_SECURITY_HEADERS
    : SECURITY_HEADERS
  for (const [header, value] of Object.entries(headers)) {
    response.headers.set(header, value)
  }
  return response
}

const securityHeadersMiddleware = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next()
  const response = await next()
  return applySecurityHeaders(response, context.url.pathname)
})

const managementAuthMiddleware = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next()

  try {
    const result = await protectManagementRoutes(context)
    if (result) return applySecurityHeaders(result, context.url.pathname)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    logger.warn(`[middleware] Management auth error: ${errorMessage}`)
    if (context.url.pathname.startsWith(ROUTES.MANAGEMENT)) {
      return applySecurityHeaders(
        context.redirect(ROUTES.LOGIN),
        context.url.pathname
      )
    }
  }

  return next()
})

const buildersAuthMiddleware = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next()

  try {
    const result = await protectBuildersRoutes(context)
    if (result) return applySecurityHeaders(result, context.url.pathname)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    logger.warn(`[middleware] Builders auth error: ${errorMessage}`)
    if (context.url.pathname.startsWith(ROUTES.BUILDERS_PREFIX)) {
      return applySecurityHeaders(
        context.redirect(ROUTES.BUILDERS_LOGIN),
        context.url.pathname
      )
    }
  }

  return next()
})

const sessionLoaderMiddleware = defineMiddleware(async (context, next) => {
  if (context.isPrerendered) return next()

  await loadCreationSession(context)

  return next()
})

export const onRequest = sequence(
  securityHeadersMiddleware,
  managementAuthMiddleware,
  buildersAuthMiddleware,
  sessionLoaderMiddleware
)
