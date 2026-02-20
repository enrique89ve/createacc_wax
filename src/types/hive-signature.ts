/**
 * Types for Hive signature verification and Keychain authentication
 */

// ===== BRANDED TYPES =====

export type HiveUsername = string & { readonly __brand: 'HiveUsername' }
export type HivePublicKey = string & { readonly __brand: 'HivePublicKey' }
export type HiveSignature = string & { readonly __brand: 'HiveSignature' }
export type HiveMessage = string & { readonly __brand: 'HiveMessage' }

// ===== HIVE ACCOUNT TYPES =====

export interface HiveKeyAuthority {
  readonly key: HivePublicKey
  readonly weight: number
}

export interface HivePosting {
  readonly weight_threshold: number
  readonly account_auths: readonly [string, number][]
  readonly key_auths: readonly [HivePublicKey, number][]
}

export interface HiveAccountData {
  readonly id: number
  readonly name: HiveUsername
  readonly created: string
  readonly posting: HivePosting
  readonly active: HivePosting
  readonly owner: HivePosting
  readonly memo_key: HivePublicKey
}

// ===== SIGNATURE VERIFICATION TYPES =====

export type HiveSerializationType = 'HF26' | 'Legacy' | 'Unknown'

export interface HiveSignatureVerificationRequest {
  readonly username: HiveUsername
  readonly message: HiveMessage
  readonly signature?: HiveSignature
  readonly publicKey?: HivePublicKey
}

export interface HiveSignatureVerificationResult {
  readonly valid: boolean
  readonly matchedKey?: HivePublicKey
  readonly serializationType?: HiveSerializationType
  readonly error?: string
  readonly details?: {
    readonly sigDigest?: string
    readonly decodedKeys?: readonly HivePublicKey[]
    readonly verifyAuthorityResult?: boolean
  }
}

export interface HiveAccountVerificationResult {
  readonly valid: boolean
  readonly error?: string
  readonly accountData?: HiveAccountData
}

// ===== KEYCHAIN TYPES =====

export interface HiveKeychainResponse {
  readonly success: boolean
  readonly message?: string
  readonly error?: string
  readonly data?: {
    readonly username?: HiveUsername
    readonly message?: HiveMessage
    readonly key?: HivePublicKey
  }
  readonly publicKey?: HivePublicKey
  readonly request_id?: number
  readonly result?: HiveSignature
  readonly signature?: HiveSignature
}

export interface HiveKeychainAuthResult {
  readonly success: boolean
  readonly username?: HiveUsername
  readonly publicKey?: HivePublicKey
  readonly message?: HiveMessage
  readonly signature?: HiveSignature
  readonly error?: string
  readonly requestId?: number
  readonly timestamp?: number
  readonly transactionId?: string
  readonly blockNum?: number
}

export interface HiveKeychainLoginParams {
  readonly username: HiveUsername
  readonly customMessage?: string
  readonly keyType?: 'Posting' | 'Active' | 'Memo'
  readonly title?: string
}

// ===== ERROR TYPES =====

export type HiveSignatureErrorCode =
  | 'INVALID_USERNAME'
  | 'INVALID_MESSAGE'
  | 'INVALID_SIGNATURE'
  | 'ACCOUNT_NOT_FOUND'
  | 'SIGNATURE_VERIFICATION_FAILED'
  | 'PUBLIC_KEY_MISMATCH'
  | 'NO_POSTING_AUTHORITY'
  | 'WAX_INITIALIZATION_FAILED'
  | 'BLOCKCHAIN_CONNECTION_ERROR'

// ===== HELPER FUNCTIONS =====

export const createHiveUsername = (username: string): HiveUsername =>
  username.trim().toLowerCase() as HiveUsername
export const createHivePublicKey = (key: string): HivePublicKey =>
  key as HivePublicKey
export const createHiveSignature = (signature: string): HiveSignature =>
  signature as HiveSignature
export const createHiveMessage = (message: string): HiveMessage =>
  message as HiveMessage
