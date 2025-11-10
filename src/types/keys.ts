/**
 * Types for Hive blockchain keys management
 */

export interface HivePublicKeys {
  readonly owner: string
  readonly active: string
  readonly posting: string
  readonly memo: string
}

export interface HivePrivateKeys {
  readonly owner: string
  readonly active: string
  readonly posting: string
  readonly memo: string
}

export interface HiveKeyPair {
  readonly publicKey: string
  readonly privateKey: string
}

export interface PublicKeysPayload {
  readonly ownerPublicKey?: string
  readonly activePublicKey?: string
  readonly postingPublicKey?: string
  readonly memoPublicKey?: string
}

export interface KeysetMetadata {
  readonly id: string
  readonly username: string
  readonly createdAt: Date
  readonly downloaded: boolean
}

export type HiveKeyRole = 'owner' | 'active' | 'posting' | 'memo'

export interface KeyValidationResult {
  readonly isValid: boolean
  readonly errors: string[]
}