import { getMessages } from './messages'
import { parseLocale, type Locale } from './locales'

export {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  LOCALE_NAMES,
  LOCALE_QUERY,
  OG_LOCALE,
  LOCALES,
  parseLocale,
  type Locale,
} from './locales'
export { interpolate } from './interpolate'
export { getMessages } from './messages'
export type { Messages } from './types'
export {
  localeRedirectUrl,
  persistLocaleCookie,
  resolveLocale,
} from './resolve-locale'

export function publicCopy(locale?: Locale): ReturnType<typeof getMessages> {
  const resolved =
    locale ??
    parseLocale(
      typeof document === 'undefined' ? undefined : document.documentElement.lang
    )
  return getMessages(resolved)
}

export {
  buildCanonicalHref,
  buildLocaleAlternates,
  defaultLocaleAlternateHref,
  type LocaleAlternate,
} from './hreflang'
