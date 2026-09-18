import type { Locale } from './locales'
import { DEFAULT_LOCALE } from './locales'
import { es } from './es'
import { en } from './en'
import { pt } from './pt'
import type { Messages } from './types'

const dictionaries: Record<Locale, Messages> = {
  es,
  en,
  pt,
}

export function getMessages(locale: Locale): Messages {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE]
}
