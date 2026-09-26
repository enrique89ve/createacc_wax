import { createHash } from 'node:crypto'
import type { PublicKeySet } from '@/types/keys'

const CONFIRMED_PUBLIC_KEYS_HASH_VERSION =
  'holahive:create:confirmed-public-keys:v1' as const
const CONFIRMED_PUBLIC_KEYS_HASH_PATTERN = /^[0-9a-f]{64}$/u

export function hashConfirmedPublicKeys(publicKeys: PublicKeySet): string {
  const canonicalPayload = JSON.stringify([
    CONFIRMED_PUBLIC_KEYS_HASH_VERSION,
    publicKeys.ownerPublicKey,
    publicKeys.activePublicKey,
    publicKeys.postingPublicKey,
    publicKeys.memoPublicKey,
  ])

  return createHash('sha256').update(canonicalPayload, 'utf8').digest('hex')
}

export function isConfirmedPublicKeysHash(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    CONFIRMED_PUBLIC_KEYS_HASH_PATTERN.test(value)
  )
}
