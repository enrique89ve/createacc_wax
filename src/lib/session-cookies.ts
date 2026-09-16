import type { AstroCookies } from 'astro'
import type { CreationSession } from '@/types/auth'
import { getRequiredEnvString } from '@/lib/env'
import { CREATION_SESSION_CONFIG, ENV_KEYS } from '@/consts/constants'
import { shouldUseSecureCookie } from '@/utils/cookie-helpers'
import { logger } from '@/lib/logger'
import {
  decodeJson,
  encodeJson,
  signPayload,
  signValue as signUtf8Value,
  verifySignedPayload,
  verifySignedValue as verifyUtf8Value,
} from '@/lib/auth/signed-cookie'

function sessionSecret(): string {
  return getRequiredEnvString(ENV_KEYS.SESSION_SECRET)
}

function isCreationSession(value: unknown): value is CreationSession {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.username === 'string' && record.username.length > 0
}

export function setCreationCookie(
  cookies: AstroCookies,
  session: CreationSession,
  request?: Request
): void {
  const signed = signPayload(encodeJson(session), sessionSecret())
  cookies.set(CREATION_SESSION_CONFIG.COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: CREATION_SESSION_CONFIG.MAX_AGE_SECONDS,
    secure: shouldUseSecureCookie(request),
  })
}

export function getCreationCookie(
  cookies: AstroCookies
): CreationSession | null {
  try {
    const cookie = cookies.get(CREATION_SESSION_CONFIG.COOKIE_NAME)
    if (!cookie?.value) return null

    const verified = verifySignedPayload(cookie.value, sessionSecret())
    if (!verified) return null

    const decoded = decodeJson(verified)
    if (!isCreationSession(decoded)) return null
    return decoded
  } catch (error) {
    logger.error('[SessionCookie] Error retrieving cookie:', {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return null
  }
}

export function clearCreationCookie(cookies: AstroCookies): void {
  cookies.delete(CREATION_SESSION_CONFIG.COOKIE_NAME, {
    path: '/',
  })
}

export function updateCreationCookie(
  cookies: AstroCookies,
  partial: Partial<CreationSession>,
  request?: Request
): void {
  const existing = getCreationCookie(cookies)
  if (!existing) {
    throw new Error('Cannot update non-existent creation session')
  }

  setCreationCookie(cookies, { ...existing, ...partial }, request)
}

export function signValue(value: string): string {
  return signUtf8Value(value, sessionSecret())
}

export function verifySignedValue(signedValue: string): string | null {
  return verifyUtf8Value(signedValue, sessionSecret())
}

export class CreationSessionManager {
  constructor(
    private readonly cookies: AstroCookies,
    private readonly request?: Request
  ) {}

  get(): CreationSession | null {
    return getCreationCookie(this.cookies)
  }

  set(data: CreationSession): void {
    setCreationCookie(this.cookies, data, this.request)
  }

  update(partial: Partial<CreationSession>): void {
    updateCreationCookie(this.cookies, partial, this.request)
  }

  clear(): void {
    clearCreationCookie(this.cookies)
  }
}
