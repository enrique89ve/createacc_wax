import type { APIContext } from 'astro'
import { CreationSessionManager } from '@/lib/session-cookies'
import type { AdminSession, BuilderSession } from '@/types/auth'
import { ROUTES } from '@/consts/constants'
import { parseRole, UserRole } from '@/lib/roles'
import { getAppAuthSession } from '@/lib/auth-session'
import { logger } from '@/lib/logger'
import { db } from '@/lib/database'
import { signUserId, userIdTokenMatchesSession } from '@/lib/user-id-token'

const CLIENT_USER_REF_QUERY_KEYS = [
	'userId',
	'user_id',
	'builderId',
	'userHash',
] as const

function unboundUserRefResponse(): Response {
	return new Response(
		JSON.stringify({ error: 'Forbidden: invalid user reference' }),
		{
			status: 403,
			headers: { 'Content-Type': 'application/json' },
		}
	)
}

function requestHasUnboundUserRef(
	request: Request,
	sessionUserId: string
): boolean {
	const url = new URL(request.url)
	for (const key of CLIENT_USER_REF_QUERY_KEYS) {
		const value = url.searchParams.get(key)
		if (!value) continue
		if (!userIdTokenMatchesSession(value, sessionUserId)) return true
	}
	return false
}

export interface RetrievedSessions {
  admin: import('@/types/auth').AdminSession | null
  creation: import('@/types/auth').CreationSession | null
}

/**
 * Helper to get the administrator session from Better Auth.
 */
export async function getAdminSession(
  request: Request
): Promise<AdminSession | null> {
  try {
    const session = await getAppAuthSession(request.headers)

    if (!session) {
      return null
    }

    const role = parseRole(session.role)
    if (role !== UserRole.Admin) {
      logger.error('Non-admin role in admin session, rejecting:', session.role)
      return null
    }

    return {
      userId: session.userId,
      userHash: signUserId(session.userId),
      username: session.username,
      role,
      loginTime: session.loginTime,
    }
  } catch (error) {
    return null
  }
}

/**
 * Loads sessions using managers only if they are not already in locals.
 */
export async function loadSessions(
  context: APIContext
): Promise<RetrievedSessions> {
  const result: RetrievedSessions = {
    admin: context.locals.adminUser ?? null,
    creation: context.locals.creation ?? null,
  }

  const needsAdmin = context.locals.adminUser === undefined
  const needsCreation = context.locals.creation === undefined

  if (!needsAdmin && !needsCreation) return result

  const [adminSession, creationSession] = await Promise.all([
    needsAdmin
      ? getAdminSession(context.request)
      : Promise.resolve(result.admin ?? null),
    needsCreation
      ? new CreationSessionManager(context.cookies, context.request).get()
      : Promise.resolve(result.creation ?? null),
  ])

  if (needsAdmin) {
    context.locals.adminUser = adminSession ?? undefined
    result.admin = adminSession ?? null
  }
  if (needsCreation && creationSession) {
    context.locals.creation = creationSession
    result.creation = creationSession
  }

  return result
}

/** Gets admin session if it exists */
export function getAdmin(context: APIContext) {
  return context.locals.adminUser ?? null
}

/** Gets creation session if it exists */
export function getCreation(context: APIContext) {
  return context.locals.creation ?? null
}

/** Requires admin session; if missing, returns redirect Response */
export async function requireAdmin(
  context: APIContext
): Promise<AdminSession | Response> {
  if (!context.locals.adminUser) {
    const session = await getAdminSession(context.request)
    if (!session) {
      return context.redirect(ROUTES.LOGIN)
    }
    context.locals.adminUser = session
    return session
  }
  return context.locals.adminUser
}

/** Specific helper for APIs that require admin session */
export async function withAdminSession<T>(
  context: APIContext,
  handler: (session: AdminSession) => T | Promise<T>
): Promise<T | Response> {
  const result = await requireAdmin(context)
  if (result instanceof Response) {
    return result
  }
  return handler(result)
}

/**
 * Specific helper for REST APIs that require admin session
 * Returns 401 Unauthorized instead of redirecting
 */
export async function withAdminApiSession<T>(
  context: APIContext,
  handler: (session: AdminSession) => T | Promise<T>
): Promise<T | Response> {
  // Try to get session from locals first
  if (context.locals.adminUser) {
    return handler(context.locals.adminUser)
  }

  // Try to get session from Better Auth
  const session = await getAdminSession(context.request)

  if (!session) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Session required' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  context.locals.adminUser = session
  return handler(session)
}

/** Ensures creation session is present or returns null (no redirect) */
export async function ensureCreation(context: APIContext) {
  if (!context.locals.creation) {
    const session = new CreationSessionManager(
      context.cookies,
      context.request
    ).get()
    if (session) {
      context.locals.creation = session
      return session
    }
    return null
  }
  return context.locals.creation
}

// ===== BUILDER SESSION HELPERS =====

/**
 * Helper to get the builder session from Better Auth.
 * Validates role === Builder and checks is_active via DB query.
 * Returns BuilderSession or null.
 */
export async function getBuilderSession(
	request: Request
): Promise<BuilderSession | null> {
	try {
		const session = await getAppAuthSession(request.headers)

		if (!session?.username) {
			return null
		}

		if (!session.userId || !session.isActive) {
			return null
		}

		const role = parseRole(session.role)
		if (role !== UserRole.Builder) {
			return null
		}

		// Verify builder is active in DB
		const result = await db.execute({
			sql: 'SELECT id, is_active FROM "user" WHERE username = ? AND role = ?',
			args: [session.username, UserRole.Builder],
		})

		if (result.rows.length === 0) {
			return null
		}

		const isActive = Boolean(result.rows[0].is_active)
		if (!isActive) {
			logger.warn(`Inactive builder attempted access: ${session.username}`)
			return null
		}

		const dbId = String(result.rows[0].id)

		return {
			userId: dbId,
			userHash: signUserId(dbId),
			username: session.username,
			role,
			loginTime: session.loginTime,
		}
	} catch (error) {
		return null
	}
}

/**
 * Specific helper for REST APIs that require builder session.
 * Returns 401 Unauthorized instead of redirecting.
 * Checks locals.builderUser first, falls back to getBuilderSession().
 */
export async function withBuilderApiSession<T>(
	context: APIContext,
	handler: (session: BuilderSession) => T | Promise<T>
): Promise<T | Response> {
	const session =
		context.locals.builderUser ?? (await getBuilderSession(context.request))

	if (!session) {
		return new Response(
			JSON.stringify({ error: 'Unauthorized: Session required' }),
			{
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			}
		)
	}

	if (requestHasUnboundUserRef(context.request, session.userId)) {
		return unboundUserRefResponse()
	}

	context.locals.builderUser = session
	return handler(session)
}

/**
 * Requires builder session for page frontmatter.
 * Returns BuilderSession or redirect Response.
 */
export async function requireBuilder(
	context: APIContext
): Promise<BuilderSession | Response> {
	if (context.locals.builderUser) {
		return context.locals.builderUser
	}

	const session = await getBuilderSession(context.request)
	if (!session) {
		return context.redirect(ROUTES.BUILDERS_LOGIN)
	}

	context.locals.builderUser = session
	return session
}
