import type { APIContext } from 'astro'
import { CreationSessionManager } from '@/lib/session-manager'
import type { AdminSession } from '@/types/auth'
import { ROUTES } from '@/consts/constants'
import { getSession } from 'auth-astro/server'
import { parseRole } from '@/lib/roles'
import { logger } from '@/lib/logger'

export interface RetrievedSessions {
  admin: import('@/types/auth').AdminSession | null
  creation: import('@/types/auth').CreationSession | null
}

/**
 * Helper to get the administrator session from Auth.js
 * Converts the Auth.js session to the format expected by the pages
 */
export async function getAdminSession(
  request: Request
): Promise<AdminSession | null> {
  try {
    const session = await getSession(request)

    if (!session?.user?.id) {
      return null
    }

    // Validate role - DO NOT degrade to builder if invalid
    const role = parseRole(session.user.role)
    if (!role) {
      logger.error('Invalid role in session, rejecting:', session.user.role)
      return null // REJECT session with invalid role
    }

    // Convert Auth.js session to AdminSession format
    return {
      userId: parseInt(session.user.id),
      username: session.user.username || '',
      role,
      loginTime: new Date(session.user.loginTime).toISOString(),
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

  // Try to get session from Auth.js
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
