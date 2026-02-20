import {
  createWaxFoundation,
  type TPublicKey,
  type IPrivateKeyData,
} from '@hiveio/wax'
import type { ICreateAccountParams } from './create-account'
import type { HiveKeyRole } from '@/types/keys'

type WaxFoundation = Awaited<ReturnType<typeof createWaxFoundation>>

let waxFoundationPromise: Promise<WaxFoundation> | undefined

// Memoize Wax foundation initialization to reuse the WASM bridge
async function getWaxFoundation(): Promise<WaxFoundation> {
  if (!waxFoundationPromise) {
    waxFoundationPromise = createWaxFoundation()
  }

  try {
    return await waxFoundationPromise
  } catch (error) {
    waxFoundationPromise = undefined
    throw error
  }
}

/**
 * Prefijo visual para distinguir el master password de las private keys WIF.
 * P5 is a Hive ecosystem convention for master passwords (vs 5J/5K/5H for WIF keys).
 * The replacement is cosmetic (first 2 chars only) and does not affect cryptographic derivation.
 * Note: some external wallets may not recognize P5 prefix — users should be aware
 * that removing P5 and restoring the original WIF prefix recovers the standard key.
 */
const MASTER_KEY_PREFIX = 'P5'

export interface KeyPair extends IPrivateKeyData {
  role: HiveKeyRole
  // Inherits wifPrivateKey and associatedPublicKey from IPrivateKeyData
  privateKey: string // Alias for wifPrivateKey for compatibility
  publicKey: TPublicKey // Alias for associatedPublicKey for compatibility
}

export interface HiveKeysLegacy {
  /** Master password in P5 format (derived from WAX brainkey) */
  masterPrivateKey: string
  /** Derived keys for each role */
  keys: KeyPair[]
}

/**
 * Class for easy handling of Hive keys
 * Provides direct access to each role without using find()
 */
export class HiveKeys {
  private readonly _masterPrivateKey: string
  private readonly _keys: ReadonlyMap<HiveKeyRole, KeyPair>

  constructor(masterPrivateKey: string, keys: KeyPair[]) {
    this._masterPrivateKey = masterPrivateKey
    this._keys = new Map(keys.map(k => [k.role, k]))
    // WAX guarantees that the generated keys are valid - we don't need to validate
  }

  /**
   * Generates new Hive keys with master password in P5 format.
   * Uses WAX suggestBrainKey() internally for cryptographic security.
   */
  static async generate(accountName: string): Promise<HiveKeys> {
    const legacyKeys = await generateHiveKeys(accountName)
    return new HiveKeys(legacyKeys.masterPrivateKey, legacyKeys.keys)
  }

  /**
   * Creates instance from existing legacy format keys
   */
  static fromLegacy(legacyKeys: HiveKeysLegacy): HiveKeys {
    return new HiveKeys(legacyKeys.masterPrivateKey, legacyKeys.keys)
  }

  // Getters for direct access to each role
  get owner(): KeyPair {
    return this._keys.get('owner')!
  }

  get active(): KeyPair {
    return this._keys.get('active')!
  }

  get posting(): KeyPair {
    return this._keys.get('posting')!
  }

  get memo(): KeyPair {
    return this._keys.get('memo')!
  }

  get masterPrivateKey(): string {
    return this._masterPrivateKey
  }

  /**
   * Gets all public keys in a flat object
   */
  getAllPublicKeys(): Record<HiveKeyRole, TPublicKey> {
    return {
      owner: this.owner.publicKey,
      active: this.active.publicKey,
      posting: this.posting.publicKey,
      memo: this.memo.publicKey,
    }
  }

  /**
   * Gets all private keys in a flat object
   */
  getAllPrivateKeys(): Record<HiveKeyRole, string> {
    return {
      owner: this.owner.privateKey,
      active: this.active.privateKey,
      posting: this.posting.privateKey,
      memo: this.memo.privateKey,
    }
  }

  /**
   * Automatically converts to the parameters needed to create an account
   */
  toCreateAccountParams(username: string): ICreateAccountParams {
    return {
      username,
      ownerPublicKey: this.owner.publicKey,
      activePublicKey: this.active.publicKey,
      postingPublicKey: this.posting.publicKey,
      memoPublicKey: this.memo.publicKey,
    }
  }

  /**
   * Converts to legacy format for compatibility
   */
  toLegacy(): HiveKeysLegacy {
    return {
      masterPrivateKey: this._masterPrivateKey,
      keys: Array.from(this._keys.values()),
    }
  }
}

/**
 * Generates Hive keys with master password in P5 format.
 *
 * Flow:
 *  1. WAX suggestBrainKey() generates a cryptographically secure WIF (5Jxxx...)
 *  2. Replace the first 2 characters with "P5" → P5xxx...
 *     This allows the user to visually distinguish the master from the private keys.
 *  3. Use the P5 master as a password to derive the 4 role keys with WAX.
 *
 * @param accountName - Hive account name
 * @returns Promise<HiveKeysLegacy> - Complete keys with master in P5 format
 */
export async function generateHiveKeys(
  accountName: string
): Promise<HiveKeysLegacy> {
  const hive = await getWaxFoundation()

  // Generates cryptographically secure brain key with native WAX
  const brainKeyData = hive.suggestBrainKey()

  // Replaces WIF prefix (5J/5K/5H) with P5 for visual distinction
  const masterPrivateKey = MASTER_KEY_PREFIX + brainKeyData.wifPrivateKey.slice(2)

  // Derives keys for each role using the P5 master as password
  const keys: KeyPair[] = (['owner', 'active', 'posting', 'memo'] as const).map(
    role => {
      const keyData = hive.getPrivateKeyFromPassword(
        accountName,
        role,
        masterPrivateKey
      )
      return {
        role,
        wifPrivateKey: keyData.wifPrivateKey,
        associatedPublicKey: keyData.associatedPublicKey,
        privateKey: keyData.wifPrivateKey,
        publicKey: keyData.associatedPublicKey as TPublicKey,
      }
    }
  )

  return { masterPrivateKey, keys }
}


