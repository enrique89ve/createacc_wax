import { defineMiddleware, sequence } from 'astro:middleware'
// Side-effect: instala hooks para normalizar valores no-Error lanzados
import '@/lib/error-normalizer'
// Side-effect: starts auto-reconciler interval (idempotent — safe to import from multiple sites)
import '@/lib/auto-reconciler'
import { HIVE_CHAIN_CONFIG, ROUTES } from '@/consts/constants'
import { CreationSessionManager } from '@/lib/session-cookies'
import {
	resolveAdminAuth,
	resolveBuilderAuth,
	type AdminUser,
	type BuilderUser,
} from '@/lib/admin/auth/helpers/auth-guards'
import type { APIContext } from 'astro'
import type { AdminSession, BuilderSession } from '@/types/auth'
import { parseRole, UserRole } from '@/lib/roles'
import { logger } from '@/lib/logger'
import { signUserId } from '@/lib/user-id-token'

function toAdminSession(user: AdminUser): AdminSession | null {
	const role = parseRole(user.role)
	if (role !== UserRole.Admin || !user.id || !user.isActive) return null

	return {
		userId: user.id,
		userHash: signUserId(user.id),
		username: user.username || '',
		role,
		loginTime:
			typeof user.loginTime === 'number' ? user.loginTime : Date.now(),
	}
}

function toBuilderSession(user: BuilderUser): BuilderSession | null {
	const role = parseRole(user.role)
	if (role !== UserRole.Builder || !user.id || !user.isActive) return null

	return {
		userId: user.id,
		userHash: signUserId(user.id),
		username: user.username || '',
		role,
		loginTime:
			typeof user.loginTime === 'number' ? user.loginTime : Date.now(),
	}
}

async function protectManagementRoutes(
	context: APIContext
): Promise<Response | null> {
	const { pathname } = context.url

	if (!pathname.startsWith(ROUTES.MANAGEMENT)) {
		return null
	}

	const authResult = await resolveAdminAuth(context.request)

	if (pathname === ROUTES.LOGIN) {
		if (authResult.kind === 'active') {
			return context.redirect(ROUTES.CONSOLE)
		}
		return null
	}

	if (authResult.kind !== 'active') {
		return context.redirect(authResult.redirectTo)
	}

	const session = toAdminSession(authResult.user)
	if (!session) {
		logger.warn('[middleware] Admin session mapping rejected')
		return context.redirect(ROUTES.LOGIN)
	}

	context.locals.adminUser = session
	return null
}

/**
 * Protects /builders/.
 * anonymous → login
 * pending (Keychain ok, not an active builder) → empty panel
 * active → locals.builderUser
 */
async function protectBuildersRoutes(
	context: APIContext
): Promise<Response | null> {
	const { pathname } = context.url

	if (!pathname.startsWith(ROUTES.BUILDERS_PREFIX)) {
		return null
	}

	const authResult = await resolveBuilderAuth(context.request)

	if (pathname === ROUTES.BUILDERS_LOGIN) {
		if (authResult.kind === 'active') {
			return context.redirect(ROUTES.BUILDERS_DASHBOARD)
		}
		if (authResult.kind === 'pending') {
			return context.redirect(`${ROUTES.BUILDERS_DASHBOARD}?pending=1`)
		}
		return null
	}

	if (authResult.kind === 'anonymous') {
		return context.redirect(authResult.redirectTo)
	}

	if (authResult.kind === 'pending') {
		context.locals.pendingBuilder = { username: authResult.username }
		return null
	}

	const session = toBuilderSession(authResult.user)
	if (!session) {
		logger.warn('[middleware] Builder session mapping rejected')
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
		const errorMessage = error instanceof Error ? error.message : 'Unknown error'
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
			"frame-ancestors 'none'",
			"base-uri 'self'",
			"form-action 'self'",
		].join('; '),
	}
}

const SECURITY_HEADERS = buildSecurityHeaders()

function applySecurityHeaders(response: Response): Response {
	for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(header, value)
	}
	return response
}

const securityHeadersMiddleware = defineMiddleware(async (context, next) => {
	if (context.isPrerendered) return next()
	const response = await next()
	return applySecurityHeaders(response)
})

const managementAuthMiddleware = defineMiddleware(async (context, next) => {
	if (context.isPrerendered) return next()

	try {
		const result = await protectManagementRoutes(context)
		if (result) return applySecurityHeaders(result)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error'
		logger.warn(`[middleware] Management auth error: ${errorMessage}`)
		if (context.url.pathname.startsWith(ROUTES.MANAGEMENT)) {
			return applySecurityHeaders(context.redirect(ROUTES.LOGIN))
		}
	}

	return next()
})

const buildersAuthMiddleware = defineMiddleware(async (context, next) => {
	if (context.isPrerendered) return next()

	try {
		const result = await protectBuildersRoutes(context)
		if (result) return applySecurityHeaders(result)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error'
		logger.warn(`[middleware] Builders auth error: ${errorMessage}`)
		if (context.url.pathname.startsWith(ROUTES.BUILDERS_PREFIX)) {
			return applySecurityHeaders(context.redirect(ROUTES.BUILDERS_LOGIN))
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
