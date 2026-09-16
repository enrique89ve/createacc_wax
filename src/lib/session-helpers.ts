import type { APIContext } from 'astro'
import { CreationSessionManager } from '@/lib/session-cookies'
import type { AdminSession, BuilderSession } from '@/types/auth'
import { ROUTES } from '@/consts/constants'
import { getAdminSession as readAdminSession } from '@/lib/auth/admin-auth'
import { getBuilderSessionCookie } from '@/lib/auth/builder-session'
import {
  blockedHiveAccountMessage,
  isHiveUsernameBlocked,
} from '@/lib/auth/blocked-hive-accounts'

export interface RetrievedSessions {
  admin: AdminSession | null
  creation: import('@/types/auth').CreationSession | null
}

export async function getAdminSession(
  request: Request
): Promise<AdminSession | null> {
  return readAdminSession(request.headers)
}

export function getBuilderSession(
  cookies: APIContext['cookies']
): BuilderSession | null {
  return getBuilderSessionCookie(cookies)
}

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
      ? Promise.resolve(
          new CreationSessionManager(context.cookies, context.request).get()
        )
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

export function getAdmin(context: APIContext) {
  return context.locals.adminUser ?? null
}

export function getCreation(context: APIContext) {
  return context.locals.creation ?? null
}

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

export async function withAdminApiSession<T>(
  context: APIContext,
  handler: (session: AdminSession) => T | Promise<T>
): Promise<T | Response> {
  if (context.locals.adminUser) {
    return handler(context.locals.adminUser)
  }

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

export async function withBuilderApiSession<T>(
  context: APIContext,
  handler: (session: BuilderSession) => T | Promise<T>
): Promise<T | Response> {
  const session =
    context.locals.builderUser ?? getBuilderSessionCookie(context.cookies)

  if (!session) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: Session required' }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  if (await isHiveUsernameBlocked(session.username)) {
    return new Response(
      JSON.stringify({ error: blockedHiveAccountMessage() }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  context.locals.builderUser = session
  return handler(session)
}

export async function requireBuilder(
  context: APIContext
): Promise<BuilderSession | Response> {
  if (context.locals.builderUser) {
    if (await isHiveUsernameBlocked(context.locals.builderUser.username)) {
      return context.redirect(ROUTES.BUILDERS_LOGIN)
    }
    return context.locals.builderUser
  }

  const session = getBuilderSessionCookie(context.cookies)
  if (!session || (await isHiveUsernameBlocked(session.username))) {
    return context.redirect(ROUTES.BUILDERS_LOGIN)
  }

  context.locals.builderUser = session
  return session
}
