export const LOCALES = ['es', 'en', 'pt'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export const LOCALE_COOKIE = 'hh_locale'

export const LOCALE_QUERY = 'lang'

export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export const LOCALE_NAMES: Record<Locale, string> = {
  es: 'Español',
  en: 'English',
  pt: 'Português',
}

/** Open Graph locale tags (language_TERRITORY). */
export const OG_LOCALE: Record<Locale, string> = {
  es: 'es_ES',
  en: 'en_US',
  pt: 'pt_BR',
}

export const LOCALE_LABELS: Record<Locale, string> = {
  es: 'ES',
  en: 'EN',
  pt: 'PT',
}

export function isLocale(value: string | null | undefined): value is Locale {
  return value === 'es' || value === 'en' || value === 'pt'
}

export function parseLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE
  const normalized = value.trim().toLowerCase()
  const primary = normalized.split('-')[0]
  return isLocale(primary) ? primary : DEFAULT_LOCALE
}
