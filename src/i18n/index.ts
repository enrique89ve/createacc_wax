import { getMessages } from './messages'
import { applySimulationPublicCopy } from './simulation-copy'
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

function isClientSimulationMode(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset.hiveTxMode === 'simulate'
}

export function publicCopy(locale?: Locale): ReturnType<typeof getMessages> {
  const resolved =
    locale ??
    parseLocale(
      typeof document === 'undefined' ? undefined : document.documentElement.lang
    )
  const messages = getMessages(resolved)
  return isClientSimulationMode()
    ? applySimulationPublicCopy(messages)
    : messages
}

export { applySimulationPublicCopy } from './simulation-copy'

export {
  buildCanonicalHref,
  buildLocaleAlternates,
  defaultLocaleAlternateHref,
  type LocaleAlternate,
} from './hreflang'
