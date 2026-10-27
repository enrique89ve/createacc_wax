import { betterAuth } from 'better-auth'
import { createHmac } from 'node:crypto'
import { z } from 'astro/zod'
import { getInviteConfiguration, type InviteConfiguration } from './config'
import { inviteIdentityHash, normalizeVerifiedProviderUserId } from './crypto'
import type { InviteIdentity, InviteProvider } from './types'

export const INVITE_AUTH_PATH = '/api/invite/auth'
const SESSION_SECONDS = 60 * 60
const IdentitySchema = z.object({
  inviteIdentityHash: z.string().regex(/^[a-f0-9]{64}$/),
  inviteProvider: z.enum(['github', 'twitter']),
  name: z.string().optional(),
})
const PROVIDER_USERNAME_PATTERN = /^[A-Za-z0-9_-]{1,39}$/

function profile(secret: string, provider: InviteProvider, id: string) {
  const identityHash = inviteIdentityHash(secret, provider, id)
  return {
    name: provider === 'github' ? 'GitHub' : 'X',
    email: `${identityHash}@invite.holahive.invalid`,
    emailVerified: false,
    image: '',
    inviteIdentityHash: identityHash,
    inviteProvider: provider,
  }
}

function providerProfile(
  secret: string,
  provider: InviteProvider,
  id: string,
  username: unknown
) {
  const mapped = profile(secret, provider, id)
  return typeof username === 'string' &&
    PROVIDER_USERNAME_PATTERN.test(username)
    ? { ...mapped, name: username }
    : mapped
}

/** Social sessions are encrypted cookies, isolated from the admin database and cookies. */
export function createInviteAuth(configuration: InviteConfiguration) {
  const github = configuration.providers.github
  const twitter = configuration.providers.twitter
  return betterAuth({
    appName: 'HolaHive invitations',
    baseURL: configuration.origin,
    basePath: INVITE_AUTH_PATH,
    secret: createHmac('sha256', configuration.authSecret)
      .update('holahive:invite-session:v1')
      .digest('hex'),
    trustedOrigins: [configuration.origin],
    socialProviders: {
      ...(github && {
        github: {
          ...github,
          disableIdTokenSignIn: true,
          disableDefaultScope: true,
          scope: ['read:user'],
          mapProfileToUser: upstream =>
            providerProfile(
              configuration.identitySecret,
              'github',
              normalizeVerifiedProviderUserId(upstream.id),
              upstream.login
            ),
        },
      }),
      ...(twitter && {
        twitter: {
          ...twitter,
          disableIdTokenSignIn: true,
          disableDefaultScope: true,
          scope: ['users.read', 'tweet.read'],
          mapProfileToUser: upstream =>
            providerProfile(
              configuration.identitySecret,
              'twitter',
              upstream.data.id,
              upstream.data.username
            ),
        },
      }),
    },
    user: {
      additionalFields: {
        // Only the server's provider mapping can populate these: user mutation
        // endpoints and extra social sign-in parameters are not exposed.
        inviteIdentityHash: { type: 'string', required: true, input: true },
        inviteProvider: { type: 'string', required: true, input: true },
      },
    },
    session: {
      expiresIn: SESSION_SECONDS,
      cookieCache: {
        enabled: true,
        maxAge: SESSION_SECONDS,
        strategy: 'jwe',
        refreshCache: false,
      },
    },
    account: {
      storeStateStrategy: 'cookie',
      storeAccountCookie: false,
      accountLinking: { enabled: false },
    },
    advanced: {
      cookiePrefix: 'holahive-invite',
      useSecureCookies: configuration.origin.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
    },
    telemetry: { enabled: false },
  })
}

async function getInviteProfile(
  request: Request,
  configuration = getInviteConfiguration()
): Promise<{
  readonly identity: InviteIdentity
  readonly username: string | null
} | null> {
  if (!configuration) return null
  const session = await createInviteAuth(configuration).api.getSession({
    headers: request.headers,
  })
  const parsed = IdentitySchema.safeParse(session?.user)
  return parsed.success
    ? {
        identity: {
          provider: parsed.data.inviteProvider,
          identityHash: parsed.data.inviteIdentityHash,
        },
        username:
          parsed.data.name && PROVIDER_USERNAME_PATTERN.test(parsed.data.name)
            ? parsed.data.name
            : null,
      }
    : null
}

export async function getInviteIdentity(
  request: Request,
  configuration = getInviteConfiguration()
): Promise<InviteIdentity | null> {
  return (await getInviteProfile(request, configuration))?.identity ?? null
}

export async function getInviteDisplayProfile(
  request: Request,
  configuration = getInviteConfiguration()
): Promise<Awaited<ReturnType<typeof getInviteProfile>>> {
  return getInviteProfile(request, configuration)
}
