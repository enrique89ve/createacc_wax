import { describe, expect, it } from 'vitest'
import {
  inviteIdentityHash,
  inviteLinkToken,
  hashInviteToken,
  inviteSecretFingerprint,
} from './crypto'
import { resolveInviteConfiguration } from './config'

const secret = 'a1'.repeat(32)

describe('private social invitation identities', () => {
  it('keeps identities stable and separates providers, accounts, keys and link tokens', () => {
    const identityHash = inviteIdentityHash(secret, 'github', '1234')
    expect(inviteIdentityHash(secret, 'github', '1234')).toBe(identityHash)
    expect(inviteIdentityHash(secret, 'twitter', '1234')).not.toBe(identityHash)
    expect(inviteIdentityHash(secret, 'github', '1235')).not.toBe(identityHash)
    expect(inviteIdentityHash('b2'.repeat(32), 'github', '1234')).not.toBe(
      identityHash
    )
    const token = inviteLinkToken(secret, { provider: 'github', identityHash })
    expect(token).not.toBe(identityHash)
    expect(hashInviteToken(token)).not.toBe(token)
    expect(inviteSecretFingerprint(secret)).not.toBe(identityHash)
  })

  it('rejects usernames, unsafe IDs, malformed tokens and weak secrets', () => {
    expect(() => inviteIdentityHash(secret, 'github', '@username')).toThrow()
    expect(() => inviteIdentityHash(secret, 'github', '1:2')).toThrow()
    expect(() => inviteIdentityHash('weak', 'github', '1234')).toThrow()
    expect(hashInviteToken('../access')).toBeNull()
  })

  it('requires private secrets and a valid canonical origin', () => {
    const environment = {
      INVITE_IDENTITY_SECRET: secret,
      AUTH_SECRET: 'test-auth-secret-with-at-least-32-chars',
    }
    expect(resolveInviteConfiguration(environment)?.origin).toBe(
      'http://localhost:4321'
    )
    expect(
      resolveInviteConfiguration({ ...environment, AUTH_SECRET: secret })
    ).toBeNull()
    expect(
      resolveInviteConfiguration({ ...environment, NODE_ENV: 'production' })
    ).toBeNull()
    expect(
      resolveInviteConfiguration({
        ...environment,
        NODE_ENV: 'production',
        AUTH_ORIGIN: 'https://join.holahive.com',
      })?.origin
    ).toBe('https://join.holahive.com')
  })
})
