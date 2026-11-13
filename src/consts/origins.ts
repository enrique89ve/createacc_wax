import { BRAND } from '@/consts/branding'

export const SITE_HOSTNAMES = {
  PRODUCTION: new URL(BRAND.URL).hostname,
  SIMULATOR: 'dev.holahive.com',
} as const

export const SITE_ORIGINS = {
  PRODUCTION: new URL(BRAND.URL).origin,
  SIMULATOR: `https://${SITE_HOSTNAMES.SIMULATOR}`,
  LOCAL: 'http://localhost:4321',
} as const

function originFromUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined
  try {
    return new URL(value.trim()).origin
  } catch {
    return undefined
  }
}

export function trustedAuthOrigins(
  environment: Readonly<Record<string, string | undefined>> = process.env
): readonly string[] {
  return [
    ...new Set(
      [
        SITE_ORIGINS.LOCAL,
        SITE_ORIGINS.PRODUCTION,
        SITE_ORIGINS.SIMULATOR,
        originFromUrl(environment.AUTH_ORIGIN),
        originFromUrl(environment.BETTER_AUTH_URL),
      ].filter((origin): origin is string => origin !== undefined)
    ),
  ]
}
