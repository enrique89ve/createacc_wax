import { auth } from '@/lib/auth'
import { execute } from '@/lib/database'
import { getCookies } from 'better-auth/cookies'
import { makeSignature } from 'better-auth/crypto'
import { UserRole, isValidRole } from '@/lib/roles'
import type { AdminSession } from '@/types/auth'
import { hiveAuthEmail } from '@/lib/auth-user'
import { logger } from '@/lib/logger'

export type FreshAdminSessionResult =
  | { readonly kind: 'authenticated'; readonly session: AdminSession }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'unavailable' }

function toAdminSession(
  result: Awaited<ReturnType<typeof auth.api.getSession>>
):
  | { readonly kind: 'authenticated'; readonly session: AdminSession }
  | { readonly kind: 'unauthenticated' } {
  if (!result?.user) return { kind: 'unauthenticated' }

  const user = result.user as typeof result.user & {
    username?: string
    role?: string
    isActive?: boolean
  }
  const username = user.username || user.name
  if (!username) return { kind: 'unauthenticated' }
  if (!isValidRole(user.role) || user.role !== UserRole.Admin) {
    return { kind: 'unauthenticated' }
  }
  if (user.isActive === false) return { kind: 'unauthenticated' }

  return {
    kind: 'authenticated',
    session: {
      userId: user.id,
      username,
      role: UserRole.Admin,
      loginTime: new Date(result.session.createdAt).getTime(),
    },
  }
}

async function resolveAdminSession(
  headersOrRequest: Headers | Request,
  disableCookieCache: boolean
): Promise<FreshAdminSessionResult> {
  const headers =
    headersOrRequest instanceof Headers
      ? headersOrRequest
      : headersOrRequest.headers
  try {
    const result = disableCookieCache
      ? await auth.api.getSession({
          headers,
          query: { disableCookieCache: true },
        })
      : await auth.api.getSession({ headers })
    if (!result?.user && disableCookieCache) {
      // Better Auth returns null for both an absent session and a swallowed
      // adapter failure, so probe the database before choosing 401 over 503.
      await execute({ sql: 'SELECT 1', args: [] })
    }
    return toAdminSession(result)
  } catch (error) {
    logger.warn(
      `[admin-auth] getSession failed: ${error instanceof Error ? error.message : 'unknown'}`
    )
    return { kind: 'unavailable' }
  }
}

export async function getAdminSession(
  headersOrRequest: Headers | Request
): Promise<AdminSession | null> {
  const result = await resolveAdminSession(headersOrRequest, false)
  return result.kind === 'authenticated' ? result.session : null
}

/** Bypass Better Auth's short-lived cookie cache before privileged mutations. */
export async function getFreshAdminSession(
  headersOrRequest: Headers | Request
): Promise<FreshAdminSessionResult> {
  return resolveAdminSession(headersOrRequest, true)
}

export async function createAdminAuthSession(params: {
  readonly username: string
}): Promise<{ token: string; userId: string } | null> {
  const ctx = await auth.$context
  const email = hiveAuthEmail(params.username)
  const existing = await ctx.internalAdapter.findUserByEmail(email)
  if (!existing?.user) return null

  const session = await ctx.internalAdapter.createSession(existing.user.id)
  if (!session) return null

  return { token: session.token, userId: existing.user.id }
}

export async function appendAdminSessionCookie(
  headers: Headers,
  token: string
): Promise<void> {
  const cookies = getCookies(auth.options)
  const sessionCookie = cookies.sessionToken
  const attributes = sessionCookie.attributes
  const context = await auth.$context
  const signedValue = `${token}.${await makeSignature(token, context.secret)}`
  const parts = [
    `${sessionCookie.name}=${encodeURIComponent(signedValue)}`,
    `Path=${attributes.path}`,
    `HttpOnly`,
    `SameSite=${String(attributes.sameSite)}`,
  ]

  if (typeof attributes.maxAge === 'number') {
    parts.push(`Max-Age=${attributes.maxAge}`)
  }
  if (attributes.secure) {
    parts.push('Secure')
  }

  headers.append('Set-Cookie', parts.join('; '))
}

export async function signOutAdmin(request: Request): Promise<void> {
  await auth.api.signOut({
    headers: request.headers,
  })
}
