import { BRAND } from '@/consts/branding'
import { DEFAULT_LOCALE, LOCALE_QUERY, LOCALES, type Locale } from './locales'

export interface LocaleAlternate {
  readonly locale: Locale
  readonly href: string
}

function buildPathWithQuery(
  pathname: string,
  searchParams: URLSearchParams
): string {
  const qs = searchParams.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/** Clean canonical URL: pathname only, no ticket/lang/tracking params. */
export function buildCanonicalHref(pathname: string): string {
  return new URL(pathname, BRAND.URL).href
}

/** Alternate URLs for hreflang (?lang= only; no ticket or tracking). */
export function buildLocaleAlternates(
  pathname: string
): readonly LocaleAlternate[] {
  return LOCALES.map(locale => {
    const params = new URLSearchParams()
    if (locale !== DEFAULT_LOCALE) {
      params.set(LOCALE_QUERY, locale)
    }
    const path = buildPathWithQuery(pathname, params)
    return {
      locale,
      href: new URL(path, BRAND.URL).href,
    }
  })
}

/** x-default href: same as canonical (default locale, no query). */
export function defaultLocaleAlternateHref(pathname: string): string {
  return buildCanonicalHref(pathname)
}
