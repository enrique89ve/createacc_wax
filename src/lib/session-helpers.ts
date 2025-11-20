import type { APIContext } from 'astro'
import { CreationSessionManager } from '@/lib/session-manager'
import type { AdminSession } from '@/types/auth'
import { ROUTES } from '@/consts/constants'
import { getSession } from 'auth-astro/server'

export interface RetrievedSessions {
  admin: import('@/types/auth').AdminSession | null
  creation: import('@/types/auth').CreationSession | null
}

/**
 * Helper para obtener la sesión de administrador desde Auth.js
 * Convierte la sesión de Auth.js al formato esperado por las páginas
 */
export async function getAdminSession(
  request: Request
): Promise<AdminSession | null> {
  try {
    const session = await getSession(request)

    if (!session?.user?.id) {
      return null
    }

    // DEBUG: Log session data

    // Convertir sesión de Auth.js al formato AdminSession
    return {
      userId: parseInt(session.user.id),
      username: session.user.username || '',
      role: (session.user.role as 'admin' | 'builder') || 'builder',
      loginTime: new Date(session.user.loginTime).toISOString(),
    }
  } catch (error) {
    return null
  }
}

/**
 * Carga sesiones usando managers sólo si aún no están en locals.
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

/** Obtiene admin session si existe */
export function getAdmin(context: APIContext) {
  return context.locals.adminUser ?? null
}

/** Obtiene creation session si existe */
export function getCreation(context: APIContext) {
  return context.locals.creation ?? null
}

/** Requiere admin session; si falta, retorna redirect Response */
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

/** Helper específico para APIs que requieren admin session */
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
 * Helper específico para APIs REST que requieren admin session
 * Retorna 401 Unauthorized en lugar de redireccionar
 */
export async function withAdminApiSession<T>(
  context: APIContext,
  handler: (session: AdminSession) => T | Promise<T>
): Promise<T | Response> {
  // Intentar obtener sesión de locals primero
  if (context.locals.adminUser) {
    return handler(context.locals.adminUser)
  }

  // Intentar obtener sesión de Auth.js
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

/** Asegura creation session presente o devuelve null (no redirect) */
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
