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
  // Hereda wifPrivateKey y associatedPublicKey de IPrivateKeyData
  privateKey: string // Alias para wifPrivateKey para compatibilidad
  publicKey: TPublicKey // Alias para associatedPublicKey para compatibilidad
}

export interface HiveKeysLegacy {
  /** Master password en formato P5 (derivado de WAX brainkey) */
  masterPrivateKey: string
  /** Claves derivadas para cada rol */
  keys: KeyPair[]
}

/**
 * Clase para manejo fácil de claves de Hive
 * Proporciona acceso directo a cada rol sin necesidad de usar find()
 */
export class HiveKeys {
  private readonly _masterPrivateKey: string
  private readonly _keys: ReadonlyMap<HiveKeyRole, KeyPair>

  constructor(masterPrivateKey: string, keys: KeyPair[]) {
    this._masterPrivateKey = masterPrivateKey
    this._keys = new Map(keys.map(k => [k.role, k]))
    // WAX garantiza que las claves generadas son válidas - no necesitamos validar
  }

  /**
   * Genera nuevas claves de Hive con master password en formato P5.
   * Usa WAX suggestBrainKey() internamente para seguridad criptográfica.
   */
  static async generate(accountName: string): Promise<HiveKeys> {
    const legacyKeys = await generateHiveKeys(accountName)
    return new HiveKeys(legacyKeys.masterPrivateKey, legacyKeys.keys)
  }

  /**
   * Crea instancia desde claves existentes en formato legacy
   */
  static fromLegacy(legacyKeys: HiveKeysLegacy): HiveKeys {
    return new HiveKeys(legacyKeys.masterPrivateKey, legacyKeys.keys)
  }

  // Getters para acceso directo a cada rol
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
   * Obtiene todas las claves públicas en un objeto plano
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
   * Obtiene todas las claves privadas en un objeto plano
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
   * Convierte automáticamente a los parámetros necesarios para crear cuenta
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
   * Convierte a formato legacy para compatibilidad
   */
  toLegacy(): HiveKeysLegacy {
    return {
      masterPrivateKey: this._masterPrivateKey,
      keys: Array.from(this._keys.values()),
    }
  }
}

/**
 * Genera claves de Hive con master password en formato P5.
 *
 * Flujo:
 *  1. WAX suggestBrainKey() genera un WIF criptográficamente seguro (5Jxxx...)
 *  2. Se reemplaza los 2 primeros caracteres por "P5" → P5xxx...
 *     Esto permite al usuario distinguir visualmente el master de las private keys.
 *  3. Se usa el master P5 como password para derivar las 4 role keys con WAX.
 *
 * @param accountName - Nombre de la cuenta de Hive
 * @returns Promise<HiveKeysLegacy> - Claves completas con master en formato P5
 */
export async function generateHiveKeys(
  accountName: string
): Promise<HiveKeysLegacy> {
  const hive = await getWaxFoundation()

  // Genera brain key criptográficamente seguro con WAX nativo
  const brainKeyData = hive.suggestBrainKey()

  // Reemplaza prefijo WIF (5J/5K/5H) con P5 para distinción visual
  const masterPrivateKey = MASTER_KEY_PREFIX + brainKeyData.wifPrivateKey.slice(2)

  // Deriva claves para cada rol usando el master P5 como password
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


