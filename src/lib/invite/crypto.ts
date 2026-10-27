import { createHash, createHmac } from 'node:crypto'
import type { InviteIdentity, InviteProvider } from './types'

const SECRET_HEX_PATTERN = /^[a-fA-F0-9]{64}$/
const IDENTITY_HASH_PATTERN = /^[a-f0-9]{64}$/
const PROVIDER_ID_PATTERN = /^[1-9][0-9]{0,29}$/

export function normalizeVerifiedProviderUserId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return String(value)
  }
  if (typeof value === 'string' && PROVIDER_ID_PATTERN.test(value)) return value
  throw new Error('Invalid verified social provider account ID')
}

export function requireInviteIdentitySecret(value: string | undefined): string {
  if (!value || !SECRET_HEX_PATTERN.test(value)) {
    throw new Error(
      'INVITE_IDENTITY_SECRET must contain 32 random bytes in hex'
    )
  }
  return value.toLowerCase()
}

function keyedHash(secret: string, value: string): string {
  return createHmac(
    'sha256',
    Buffer.from(requireInviteIdentitySecret(secret), 'hex')
  )
    .update(value)
    .digest('hex')
}

export function inviteIdentityHash(
  secret: string,
  provider: InviteProvider,
  providerUserId: string
): string {
  if (!PROVIDER_ID_PATTERN.test(providerUserId)) {
    throw new Error('Invalid verified social provider account ID')
  }
  return keyedHash(secret, `${provider}:${providerUserId}`)
}

export function inviteLinkToken(
  secret: string,
  identity: InviteIdentity
): string {
  if (!IDENTITY_HASH_PATTERN.test(identity.identityHash)) {
    throw new Error('Invalid invitation identity hash')
  }
  return keyedHash(
    secret,
    `invite-link:v1:${identity.provider}:${identity.identityHash}`
  )
}

export function hashInviteToken(token: string): string | null {
  return IDENTITY_HASH_PATTERN.test(token)
    ? createHash('sha256').update(token).digest('hex')
    : null
}

export function inviteSecretFingerprint(secret: string): string {
  return keyedHash(secret, 'holahive:invite-identity-key:v1')
}
