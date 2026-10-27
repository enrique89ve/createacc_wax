import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'astro/zod'
import { handleInviteAuthRequest } from './auth-handler'
import { getInviteIdentity, INVITE_AUTH_PATH } from './auth'
import { inviteIdentityHash } from './crypto'
import type { InviteConfiguration } from './config'
import type { InviteProvider } from './types'

const configuration: InviteConfiguration = {
  identitySecret: 'a1'.repeat(32),
  authSecret: 'test-invite-auth-secret-with-more-than-32-chars',
  origin: 'http://localhost:4321',
  providers: {
    github: { clientId: 'test-github', clientSecret: 'test-github-secret' },
    twitter: { clientId: 'test-twitter', clientSecret: 'test-twitter-secret' },
  },
}

function cookieHeader(headers: Headers, previous = ''): string {
  const cookies = new Map(
    previous
      .split('; ')
      .filter(Boolean)
      .map(value => {
        const separator = value.indexOf('=')
        return [value.slice(0, separator), value.slice(separator + 1)]
      })
  )
  for (const value of headers.getSetCookie()) {
    const cookie = value.split(';', 1)[0]
    const separator = cookie.indexOf('=')
    cookies.set(cookie.slice(0, separator), cookie.slice(separator + 1))
  }
  return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
}

function mockProviderNetwork(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = input instanceof Request ? input.url : String(input)
      if (
        url.includes('/oauth/access_token') ||
        url.includes('/oauth2/token')
      ) {
        return Response.json({
          access_token: 'test-provider-token',
          token_type: 'bearer',
          expires_in: 3600,
          scope: 'read:user user:email',
        })
      }
      if (url === 'https://api.github.com/user')
        return Response.json({
          id: 1234,
          login: 'renamed',
          name: 'Private Person',
          email: null,
        })
      if (url === 'https://api.github.com/user/emails') return Response.json([])
      if (url.startsWith('https://api.x.com/2/users/me'))
        return Response.json({
          data: { id: '5678', username: 'renamed', name: 'Private Person' },
        })
      throw new Error(
        'Unexpected provider network request in isolated OAuth test'
      )
    })
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('isolated invitation OAuth', () => {
  it.each<InviteProvider>(['github', 'twitter'])(
    'verifies %s through OAuth and keeps the public handle beside pseudonymous identity',
    async provider => {
      mockProviderNetwork()
      const signIn = await handleInviteAuthRequest(
        new Request(
          `${configuration.origin}${INVITE_AUTH_PATH}/sign-in/social`,
          {
            method: 'POST',
            headers: {
              origin: configuration.origin,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ provider }),
          }
        ),
        configuration
      )
      expect(signIn.status).toBe(200)
      const signInData = z
        .object({ url: z.string() })
        .parse(await signIn.json())
      const state = new URL(signInData.url).searchParams.get('state')
      expect(state).toBeTruthy()
      const callback = await handleInviteAuthRequest(
        new Request(
          `${configuration.origin}${INVITE_AUTH_PATH}/callback/${provider}?code=test-code&state=${state}`,
          {
            headers: { cookie: cookieHeader(signIn.headers) },
          }
        ),
        configuration
      )
      expect(callback.status).toBe(302)
      expect(callback.headers.get('location')).toBe(
        `${configuration.origin}/invite`
      )
      const cookies = cookieHeader(callback.headers)
      expect(cookies).toContain('holahive-invite.session_data=')
      expect(cookies).not.toContain('account_data=')
      const identity = await getInviteIdentity(
        new Request(configuration.origin, { headers: { cookie: cookies } }),
        configuration
      )
      expect(identity).toEqual({
        provider,
        identityHash: inviteIdentityHash(
          configuration.identitySecret,
          provider,
          provider === 'github' ? '1234' : '5678'
        ),
      })
      expect(cookies).not.toContain('test-provider-token')
      expect(
        await getInviteIdentity(
          new Request(configuration.origin, {
            headers: { cookie: 'holahive-invite.session_data=forged' },
          }),
          configuration
        )
      ).toBeNull()
    }
  )

  it('rejects cross-origin sign-in, injected profile fields and unexposed mutation endpoints', async () => {
    for (const [origin, body, status] of [
      ['https://attacker.invalid', { provider: 'github' }, 403],
      [
        configuration.origin,
        { provider: 'github', inviteIdentityHash: 'f'.repeat(64) },
        400,
      ],
      [
        configuration.origin,
        { provider: 'github', idToken: { token: 'forged' } },
        400,
      ],
    ] as const) {
      const response = await handleInviteAuthRequest(
        new Request(
          `${configuration.origin}${INVITE_AUTH_PATH}/sign-in/social`,
          {
            method: 'POST',
            headers: { origin, 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
        ),
        configuration
      )
      expect(response.status).toBe(status)
    }
    const update = await handleInviteAuthRequest(
      new Request(`${configuration.origin}${INVITE_AUTH_PATH}/update-user`, {
        method: 'POST',
      }),
      configuration
    )
    expect(update.status).toBe(404)
  })
})
