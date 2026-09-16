import { isPublicKey, type TPublicKey } from '@hiveio/wax'
import type { PublicKeySet } from '@/types/keys'

/**
 * Type guard that verifies if a public key is valid using wax
 * Updated to use standard type guard pattern
 * @param key - Key to validate
 * @returns true if valid and acts as type guard
 */
export function checkPublicKeyFormat(key: unknown): key is string {
  return typeof key === 'string' && isPublicKey(key)
}

/**
 * Specific type guard for Wax TPublicKey
 * Verifies that it is a valid public key with specific type
 * @param key - Key to validate
 * @returns true if valid TPublicKey
 */
export function isValidPublicKey(key: unknown): key is TPublicKey {
  // checkPublicKeyFormat already includes isPublicKey(), no need for double validation
  return checkPublicKeyFormat(key)
}

/**
 * Validates a public key and throws error if invalid
 * Simple function that throws error - without advanced TypeScript
 * @param key - Key to validate
 * @param keyType - Key type (owner, active, etc.) for error messages
 * @throws Error if key is invalid
 */
export function validatePublicKeyOrThrow(key: unknown, keyType?: string): void {
  if (!checkPublicKeyFormat(key)) {
    const keyName = keyType ? `${keyType} key` : 'key'
    throw new Error(`Invalid ${keyName}: ${JSON.stringify(key)}`)
  }
}

/**
 * Converts an already validated key to TPublicKey
 * Simple cast after validation - without complex type guards
 * @param key - Key already validated
 * @returns Key with correct type
 */
export function castToPublicKey(key: string): TPublicKey {
  return key as TPublicKey
}

/**
 * Untrusted public-key payload (request body, JSON).
 * Validated output is {@link PublicKeySet}.
 */
export interface UncheckedPublicKeySet {
  readonly ownerPublicKey: unknown
  readonly activePublicKey: unknown
  readonly postingPublicKey: unknown
  readonly memoPublicKey: unknown
}

/**
 * Validates a complete set of Hive public keys
 * Simple step-by-step logic - without advanced concepts
 * @param keySet - Set of keys to validate
 * @returns Validated set with correct types
 * @throws Error if any key is invalid
 */
export function validateHiveKeySet(
  keySet: UncheckedPublicKeySet
): PublicKeySet {
  // Validate each key individually - step by step
  validatePublicKeyOrThrow(keySet.ownerPublicKey, 'owner')
  validatePublicKeyOrThrow(keySet.activePublicKey, 'active')
  validatePublicKeyOrThrow(keySet.postingPublicKey, 'posting')
  validatePublicKeyOrThrow(keySet.memoPublicKey, 'memo')

  // If we get here, all are valid - convert to correct types
  return {
    ownerPublicKey: castToPublicKey(keySet.ownerPublicKey as string),
    activePublicKey: castToPublicKey(keySet.activePublicKey as string),
    postingPublicKey: castToPublicKey(keySet.postingPublicKey as string),
    memoPublicKey: castToPublicKey(keySet.memoPublicKey as string),
  }
}
