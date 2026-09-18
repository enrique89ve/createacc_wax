import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, isLocale, parseLocale } from './locales'
import { interpolate } from './interpolate'
import { getMessages } from './messages'

describe('parseLocale', () => {
  it('defaults to English', () => {
    expect(parseLocale(undefined)).toBe(DEFAULT_LOCALE)
    expect(parseLocale(null)).toBe('en')
    expect(parseLocale('fr')).toBe('en')
  })

  it('accepts es, en, pt and regional tags', () => {
    expect(isLocale('es')).toBe(true)
    expect(parseLocale('en')).toBe('en')
    expect(parseLocale('pt-BR')).toBe('pt')
    expect(parseLocale('EN-US')).toBe('en')
  })
})

describe('getMessages', () => {
  it('keeps the same keys across locales', () => {
    const es = getMessages('es')
    const en = getMessages('en')
    const pt = getMessages('pt')
    expect(Object.keys(en.home)).toEqual(Object.keys(es.home))
    expect(Object.keys(pt.username.format)).toEqual(
      Object.keys(es.username.format)
    )
  })

  it('does not show ticket or Web3 on the home copy', () => {
    for (const locale of ['es', 'en', 'pt'] as const) {
      const home = JSON.stringify(getMessages(locale).home)
      expect(home.toLowerCase()).not.toContain('ticket')
      expect(home.toLowerCase()).not.toContain('web3')
    }
  })
})

describe('interpolate', () => {
  it('replaces placeholders', () => {
    expect(interpolate('@{username} está disponible', { username: 'enrique' })).toBe(
      '@enrique está disponible'
    )
  })
})

describe('details and success dictionaries', () => {
  it('keeps the same keys across locales', () => {
    const es = getMessages('es')
    const en = getMessages('en')
    const pt = getMessages('pt')
    expect(Object.keys(en.details)).toEqual(Object.keys(es.details))
    expect(Object.keys(pt.details)).toEqual(Object.keys(es.details))
    expect(Object.keys(en.progress)).toEqual(Object.keys(es.progress))
    expect(Object.keys(pt.success.apps)).toEqual(Object.keys(es.success.apps))
    expect(Object.keys(en.keys.roleNames)).toEqual(Object.keys(es.keys.roleNames))
  })
  it('includes export labels for TXT and PDF keys', () => {
    for (const locale of ['es', 'en', 'pt'] as const) {
      const keys = getMessages(locale).keys
      expect(keys.generatedAtLabel.length).toBeGreaterThan(0)
      expect(keys.pdfMasterPasswordLabel).toBe('Master Password')
      expect(keys.roleNames.master).toBe('MASTER')
    }
  })

})

describe('hreflang and canonical', () => {
  it('builds clean canonical and hreflang without ticket or tracking', async () => {
    const {
      buildCanonicalHref,
      buildLocaleAlternates,
      defaultLocaleAlternateHref,
    } = await import('./hreflang')

    expect(buildCanonicalHref('/')).toBe('https://join.holahive.com/')
    expect(buildCanonicalHref('/')).not.toContain('ticket')
    expect(buildCanonicalHref('/')).not.toContain('lang=')

    const alternates = buildLocaleAlternates('/')
    expect(alternates.find(a => a.locale === 'en')?.href).toBe(
      'https://join.holahive.com/'
    )
    expect(alternates.find(a => a.locale === 'es')?.href).toContain('lang=es')
    expect(alternates.find(a => a.locale === 'es')?.href).not.toContain('ticket')

    expect(defaultLocaleAlternateHref('/')).toBe('https://join.holahive.com/')
  })
})
