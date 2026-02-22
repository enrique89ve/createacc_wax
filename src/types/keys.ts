/**
 * Types for Hive blockchain keys management
 */

export interface PublicKeysPayload {
  readonly ownerPublicKey?: string
  readonly activePublicKey?: string
  readonly postingPublicKey?: string
  readonly memoPublicKey?: string
}

export type HiveKeyRole = 'owner' | 'active' | 'posting' | 'memo'
