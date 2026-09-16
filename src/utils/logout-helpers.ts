import {
  BUILDER_SESSION_CONFIG,
  CREATION_SESSION_CONFIG,
} from '@/consts/constants'
import { shouldUseSecureCookie } from '@/utils/cookie-helpers'

const SESSION_COOKIES_TO_CLEAR = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'authjs.csrf-token',
  '__Host-authjs.csrf-token',
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
  'better-auth.session_data',
  '__Secure-better-auth.session_data',
  CREATION_SESSION_CONFIG.COOKIE_NAME,
  BUILDER_SESSION_CONFIG.COOKIE_NAME,
] as const

function requiresSecureAttribute(cookieName: string): boolean {
  return cookieName.startsWith('__Secure-') || cookieName.startsWith('__Host-')
}

function buildExpiredCookieHeader(
  cookieName: string,
  isSecure: boolean
): string {
  const options = [
    `${cookieName}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'SameSite=Strict',
  ]

  if (isSecure || requiresSecureAttribute(cookieName)) {
    options.push('Secure')
  }

  return options.join('; ')
}

/**
 * Build response headers that expire all session cookies.
 * Uses shouldUseSecureCookie for proper HTTPS detection (including reverse proxies).
 */
export function buildLogoutHeaders(request: Request): Headers {
  const isSecure = shouldUseSecureCookie(request)
  const headers = new Headers()
  headers.append('Content-Type', 'application/json')

  for (const name of SESSION_COOKIES_TO_CLEAR) {
    headers.append('Set-Cookie', buildExpiredCookieHeader(name, isSecure))
  }

  return headers
}
