import { auth } from '@/lib/auth'
import { getCookies } from 'better-auth/cookies'
import { makeSignature } from 'better-auth/crypto'
import { UserRole, isValidRole } from '@/lib/roles'
import type { AdminSession } from '@/types/auth'
import { hiveAuthEmail } from '@/lib/auth-user'
import { logger } from '@/lib/logger'

export async function getAdminSession(
  headersOrRequest: Headers | Request
): Promise<AdminSession | null> {
  try {
    const headers =
      headersOrRequest instanceof Headers
        ? headersOrRequest
        : headersOrRequest.headers
    const result = await auth.api.getSession({ headers })
    if (!result?.user) return null

    const user = result.user as typeof result.user & {
      username?: string
      role?: string
      isActive?: boolean
    }

    const username = user.username || user.name
    if (!username) return null

    const role = user.role
    if (!isValidRole(role) || role !== UserRole.Admin) return null
    if (user.isActive === false) return null

    return {
      userId: user.id,
      username,
      role: UserRole.Admin,
      loginTime: new Date(result.session.createdAt).getTime(),
    }
  } catch (error) {
    logger.warn(
      `[admin-auth] getSession failed: ${error instanceof Error ? error.message : 'unknown'}`
    )
    return null
  }
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
