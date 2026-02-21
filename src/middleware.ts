import { defineMiddleware, sequence } from 'astro:middleware'
// Side-effect: instala hooks para normalizar valores no-Error lanzados
import '@/lib/error-normalizer'
// Side-effect: starts auto-reconciler interval (idempotent — safe to import from multiple sites)
import '@/lib/auto-reconciler'
import { ROUTES } from '@/consts/constants'
import { CreationSessionManager } from '@/lib/session-manager'
import {
	requireAdminAuth,
	requireBuildersAuth,
} from '@/lib/admin/auth/helpers/auth-guards'
import type { APIContext } from 'astro'
import type { AdminSession, BuilderSession } from '@/types/auth'
import type { AuthenticatedUser } from '@/lib/admin/auth/helpers/auth-guards'
import { parseRole } from '@/lib/roles'
import { getBooleanEnv } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * Maps an AuthenticatedUser from the guard to AdminSession for locals.
 * Rejects temporary users (ID 0) and invalid roles.
 */
function mapGuardResultToAdmin(guardResult: AuthenticatedUser): AdminSession {
	const userId = guardResult.id

	if (!userId || userId === 0) {
		throw new Error('Invalid user ID: temporary users cannot access management')
	}

	const role = parseRole(guardResult.role)
	if (!role) {
		throw new Error(`Invalid role: ${guardResult.role}`)
	}

	return {
		userId,
		username: guardResult.username || '',
		role,
		loginTime: typeof guardResult.loginTime === 'number'
			? guardResult.loginTime
			: Date.now(),
	}
}

/**
 * Maps an AuthenticatedUser from the guard to BuilderSession for locals.
 */
function mapGuardResultToBuilder(guardResult: AuthenticatedUser): BuilderSession {
	const userId = guardResult.id

	if (!userId || userId === 0) {
		throw new Error('Invalid user ID: temporary users cannot access builders')
	}

	const role = parseRole(guardResult.role)
	if (!role) {
		throw new Error(`Invalid role: ${guardResult.role}`)
	}

	return {
		userId,
		username: guardResult.username || '',
		role,
		loginTime: typeof guardResult.loginTime === 'number'
			? guardResult.loginTime
			: Date.now(),
	}
}

/**
 * Protects routes under /management/ using auth guards
 */
async function protectManagementRoutes(
	context: APIContext
): Promise<Response | null> {
	const { pathname } = context.url

	if (!pathname.startsWith(ROUTES.MANAGEMENT)) {
		return null
	}

	// Login page: redirect to console if already authenticated
	if (pathname === ROUTES.LOGIN) {
		const authResult = await requireAdminAuth(context.request)
		if (authResult.isAuthenticated) {
			return context.redirect(ROUTES.CONSOLE)
		}
		return null
	}

	const authResult = await requireAdminAuth(context.request)

	if (!authResult.isAuthenticated) {
		return context.redirect(authResult.redirectTo || ROUTES.LOGIN)
	}

	try {
		if (authResult.user) {
			context.locals.adminUser = mapGuardResultToAdmin(authResult.user)
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown mapping error'
		logger.warn(`[middleware] Guard mapping error: ${errorMessage}`)
		return context.redirect(ROUTES.LOGIN)
	}

	return null
}

/**
 * Protects routes under /builders/ using auth guards.
 * Stores authenticated builder in locals.builderUser.
 */
async function protectBuildersRoutes(
	context: APIContext
): Promise<Response | null> {
	const { pathname } = context.url

	if (!pathname.startsWith(ROUTES.BUILDERS_PREFIX)) {
		return null
	}

	// Login page: redirect to dashboard if already authenticated
	if (pathname === ROUTES.BUILDERS_LOGIN) {
		const authResult = await requireBuildersAuth(context.request)
		if (authResult.isAuthenticated) {
			return context.redirect(ROUTES.BUILDERS_DASHBOARD)
		}
		return null
	}

	const authResult = await requireBuildersAuth(context.request)

	if (!authResult.isAuthenticated) {
		return context.redirect(authResult.redirectTo || ROUTES.BUILDERS_LOGIN)
	}

	try {
		if (authResult.user) {
			context.locals.builderUser = mapGuardResultToBuilder(authResult.user)
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown mapping error'
		logger.warn(`[middleware] Builder guard mapping error: ${errorMessage}`)
		return context.redirect(ROUTES.BUILDERS_LOGIN)
	}

	return null
}

/**
 * Loads the creation session into locals for all pages
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
		const errorMessage = error instanceof Error ? error.message : 'Unknown error'
		logger.warn(`[middleware] Creation session load error: ${errorMessage}`)
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

// --- Composable middleware functions ---

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
