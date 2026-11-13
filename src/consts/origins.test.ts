import { afterEach, describe, expect, it } from 'vitest'
import {
  SITE_HOSTNAMES,
  SITE_ORIGINS,
  trustedAuthOrigins,
} from '@/consts/origins'
import { BRAND } from '@/consts/branding'

afterEach(() => {
  delete process.env.AUTH_ORIGIN
  delete process.env.BETTER_AUTH_URL
})

describe('site origins', () => {
  it('keeps the canonical brand host separate from the simulator host', () => {
    expect(SITE_HOSTNAMES.PRODUCTION).toBe(new URL(BRAND.URL).hostname)
    expect(SITE_HOSTNAMES.SIMULATOR).toBe('dev.holahive.com')
    expect(SITE_ORIGINS.PRODUCTION).toBe(BRAND.URL.replace(/\/$/, ''))
    expect(SITE_ORIGINS.SIMULATOR).toBe('https://dev.holahive.com')
  })

  it('always trusts local, canonical, and simulator origins', () => {
    expect(trustedAuthOrigins({})).toEqual([
      SITE_ORIGINS.LOCAL,
      SITE_ORIGINS.PRODUCTION,
      SITE_ORIGINS.SIMULATOR,
    ])
  })

  it('adds runtime AUTH_ORIGIN without duplicating the simulator origin', () => {
    expect(
      trustedAuthOrigins({
        AUTH_ORIGIN: 'https://dev.holahive.com/',
        BETTER_AUTH_URL: 'https://dev.holahive.com',
      })
    ).toEqual([
      SITE_ORIGINS.LOCAL,
      SITE_ORIGINS.PRODUCTION,
      SITE_ORIGINS.SIMULATOR,
    ])
  })

  it('ignores invalid runtime origin values', () => {
    expect(
      trustedAuthOrigins({
        AUTH_ORIGIN: 'not-a-url',
        BETTER_AUTH_URL: '',
      })
    ).toEqual([
      SITE_ORIGINS.LOCAL,
      SITE_ORIGINS.PRODUCTION,
      SITE_ORIGINS.SIMULATOR,
    ])
  })
})
