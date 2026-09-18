import type { AstroCookies } from 'astro'
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  LOCALE_QUERY,
  type Locale,
} from './locales'
import { shouldUseSecureCookie } from '@/utils/cookie-helpers'

export interface LocaleResolution {
  readonly locale: Locale
  readonly requestedLocale: Locale | null
  readonly shouldRedirect: boolean
}

function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null
  const tags = header.split(',').map(part => part.split(';')[0]?.trim().toLowerCase())
  for (const tag of tags) {
    if (!tag) continue
    const primary = tag.split('-')[0]
    if (isLocale(primary)) return primary
  }
  return null
}

export function resolveLocale(input: {
  readonly url: URL
  readonly cookies: AstroCookies
  readonly acceptLanguage: string | null
}): LocaleResolution {
  const requested = input.url.searchParams.get(LOCALE_QUERY)
  if (isLocale(requested)) {
    return {
      locale: requested,
      requestedLocale: requested,
      shouldRedirect: true,
    }
  }

  const cookie = input.cookies.get(LOCALE_COOKIE)?.value
  if (isLocale(cookie)) {
    return { locale: cookie, requestedLocale: null, shouldRedirect: false }
  }

  return {
    locale: localeFromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE,
    requestedLocale: null,
    shouldRedirect: false,
  }
}

export function persistLocaleCookie(
  cookies: AstroCookies,
  locale: Locale,
  request: Request
): void {
  cookies.set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    secure: shouldUseSecureCookie(request),
  })
}

export function localeRedirectUrl(url: URL): string {
  const next = new URL(url)
  next.searchParams.delete(LOCALE_QUERY)
  return `${next.pathname}${next.search}`
}
