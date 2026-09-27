import { createHash } from 'node:crypto'
import type { PublicKeySet } from '@/types/keys'
import type { HiveExecutionMode } from '@/consts/hive-execution'

export interface CreationIntent {
  readonly username: string
  readonly ticket: string
  readonly executionMode: HiveExecutionMode
  readonly publicKeys: PublicKeySet
}

/** Fingerprint only: authentication is provided by the signed session cookie. */
export function hashCreationIntent(intent: CreationIntent): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'holahive:create:intent:v1',
        'hive:mainnet',
        intent.executionMode,
        intent.username,
        intent.ticket.trim().toUpperCase(),
        hashConfirmedPublicKeys(intent.publicKeys),
      ])
    )
    .digest('hex')
}

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
    typeof value === 'string' && CONFIRMED_PUBLIC_KEYS_HASH_PATTERN.test(value)
  )
}
