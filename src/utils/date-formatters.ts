/**
 * Utilities for formatting dates normalized to UTC-0.
 * SQLite stores timestamps without time zone, UTC is assumed.
 */

import { interpolate } from '@/i18n/interpolate'
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales'
import { getMessages } from '@/i18n/messages'

const INTL_LOCALE: Record<Locale, string> = {
  es: 'es-ES',
  en: 'en-US',
  pt: 'pt-BR',
}

function toUtcDate(dateStr: string): Date {
  const normalized = dateStr.endsWith('Z') ? dateStr : `${dateStr}Z`
  return new Date(normalized)
}

function intlLocale(locale: Locale): string {
  return INTL_LOCALE[locale]
}

export function formatDate(
  dateStr: string,
  locale: Locale = DEFAULT_LOCALE
): string {
  return toUtcDate(dateStr).toLocaleDateString(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatDateTime(
  dateStr: string,
  locale: Locale = DEFAULT_LOCALE
): string {
  return toUtcDate(dateStr).toLocaleDateString(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

export function formatDateTimeFull(
  dateStr: string,
  locale: Locale = DEFAULT_LOCALE
): string {
  return toUtcDate(dateStr).toLocaleDateString(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'UTC',
  })
}

export function formatTime(
  dateStr: string,
  locale: Locale = DEFAULT_LOCALE
): string {
  return toUtcDate(dateStr).toLocaleTimeString(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

export function formatRelativeDate(
  dateStr: string,
  locale: Locale = DEFAULT_LOCALE
): string {
  const date = toUtcDate(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const time = getMessages(locale).time

  if (diffDays <= 0) return time.today
  if (diffDays === 1) return time.yesterday
  if (diffDays < 7) return interpolate(time.daysAgo, { days: String(diffDays) })

  return formatDate(dateStr, locale)
}

export function formatShortDateTime(
  dateStr: string,
  locale: Locale = DEFAULT_LOCALE
): string {
  return toUtcDate(dateStr).toLocaleDateString(intlLocale(locale), {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}
