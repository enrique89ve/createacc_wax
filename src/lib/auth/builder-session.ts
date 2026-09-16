import type { AstroCookies } from 'astro'
import type { BuilderSession } from '@/types/auth'
import { UserRole } from '@/lib/roles'
import { getRequiredEnvString } from '@/lib/env'
import { BUILDER_SESSION_CONFIG, ENV_KEYS } from '@/consts/constants'
import { shouldUseSecureCookie } from '@/utils/cookie-helpers'
import {
  decodeJson,
  encodeJson,
  signPayload,
  verifySignedPayload,
} from '@/lib/auth/signed-cookie'
import { logger } from '@/lib/logger'

function sessionSecret(): string {
  return getRequiredEnvString(ENV_KEYS.SESSION_SECRET)
}

function isBuilderSession(value: unknown): value is BuilderSession {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.username === 'string' &&
    record.username.length > 0 &&
    record.role === UserRole.Builder &&
    typeof record.issuedAt === 'number' &&
    typeof record.expiresAt === 'number'
  )
}

export function createBuilderSession(username: string): BuilderSession {
  const issuedAt = Date.now()
  return {
    username,
    role: UserRole.Builder,
    issuedAt,
    expiresAt: issuedAt + BUILDER_SESSION_CONFIG.MAX_AGE_SECONDS * 1000,
  }
}

export function setBuilderSessionCookie(
  cookies: AstroCookies,
  session: BuilderSession,
  request?: Request
): void {
  const signed = signPayload(encodeJson(session), sessionSecret())
  cookies.set(BUILDER_SESSION_CONFIG.COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: BUILDER_SESSION_CONFIG.MAX_AGE_SECONDS,
    secure: shouldUseSecureCookie(request),
  })
}

export function getBuilderSessionCookie(
  cookies: AstroCookies
): BuilderSession | null {
  try {
    const cookie = cookies.get(BUILDER_SESSION_CONFIG.COOKIE_NAME)
    if (!cookie?.value) return null

    const verified = verifySignedPayload(cookie.value, sessionSecret())
    if (!verified) return null

    const decoded = decodeJson(verified)
    if (!isBuilderSession(decoded)) return null
    if (decoded.expiresAt <= Date.now()) return null

    return decoded
  } catch (error) {
    logger.warn('[builder-session] failed to read cookie', {
      error: error instanceof Error ? error.message : 'unknown',
    })
    return null
  }
}

export function clearBuilderSessionCookie(cookies: AstroCookies): void {
  cookies.delete(BUILDER_SESSION_CONFIG.COOKIE_NAME, { path: '/' })
}
