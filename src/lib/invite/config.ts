import { requireInviteIdentitySecret } from './crypto'
import type { InviteProvider } from './types'

interface ProviderCredentials {
  readonly clientId: string
  readonly clientSecret: string
}

export interface InviteConfiguration {
  readonly identitySecret: string
  readonly authSecret: string
  readonly origin: string
  readonly providers: Partial<Record<InviteProvider, ProviderCredentials>>
}

export interface InviteEnvironment
  extends Readonly<Record<string, string | undefined>> {
  readonly INVITE_IDENTITY_SECRET?: string
  readonly AUTH_SECRET?: string
  readonly AUTH_ORIGIN?: string
  readonly BETTER_AUTH_URL?: string
  readonly AUTH_URL?: string
  readonly GITHUB_CLIENT_ID?: string
  readonly GITHUB_CLIENT_SECRET?: string
  readonly TWITTER_CLIENT_ID?: string
  readonly TWITTER_CLIENT_SECRET?: string
  readonly NODE_ENV?: string
}

function credentials(
  clientId: string | undefined,
  clientSecret: string | undefined
): ProviderCredentials | undefined {
  return clientId?.trim() && clientSecret?.trim()
    ? { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
    : undefined
}

export function resolveInviteConfiguration(
  environment: InviteEnvironment
): InviteConfiguration | null {
  try {
    const identitySecret = requireInviteIdentitySecret(
      environment.INVITE_IDENTITY_SECRET
    )
    const authSecret = environment.AUTH_SECRET?.trim() ?? ''
    if (authSecret.length < 32 || authSecret.toLowerCase() === identitySecret) {
      return null
    }
    const originUrl = new URL(
      environment.AUTH_ORIGIN ??
        environment.BETTER_AUTH_URL ??
        environment.AUTH_URL ??
        'http://localhost:4321'
    )
    if (!['http:', 'https:'].includes(originUrl.protocol)) return null
    if (
      environment.NODE_ENV === 'production' &&
      originUrl.protocol !== 'https:'
    ) {
      return null
    }
    const github = credentials(
      environment.GITHUB_CLIENT_ID,
      environment.GITHUB_CLIENT_SECRET
    )
    const twitter = credentials(
      environment.TWITTER_CLIENT_ID,
      environment.TWITTER_CLIENT_SECRET
    )
    return {
      identitySecret,
      authSecret,
      origin: originUrl.origin,
      providers: { ...(github && { github }), ...(twitter && { twitter }) },
    }
  } catch {
    return null
  }
}

export function getInviteConfiguration(): InviteConfiguration | null {
  return resolveInviteConfiguration(process.env)
}
