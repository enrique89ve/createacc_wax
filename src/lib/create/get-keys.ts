import {
  createWaxFoundation,
  type TPublicKey,
  type IPrivateKeyData,
  isPublicKey,
} from '@hiveio/wax/vite'
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
 * Genera una clave aleatoria en formato personalizado P5 + 50 caracteres
 * Similar al formato usado en Python: P5 + random chars
 *
 * @returns string - Clave aleatoria en formato P5...
 */
export function generateRandomP5Key(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const prefix = 'P5'
  const keyLength = 50

  // Validar que tenemos caracteres disponibles
  if (chars.length === 0) {
    throw new Error('Conjunto de caracteres no puede estar vacío')
  }

  // Usar crypto para mayor aleatoriedad si está disponible
  const getRandomIndex = (): number => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const array = new Uint32Array(1)
      crypto.getRandomValues(array)
      return array[0] % chars.length
    }
    // Fallback a Math.random
    return Math.floor(Math.random() * chars.length)
  }

  let result = prefix

  try {
    for (let i = 0; i < keyLength; i++) {
      const randomIndex = getRandomIndex()
      result += chars.charAt(randomIndex)
    }
  } catch (error) {
    throw new Error(
    )
  }

  // Validar que la clave generada tiene el formato correcto
  if (
    !result.startsWith(prefix) ||
    result.length !== prefix.length + keyLength
  ) {
    throw new Error('Error en la generación de clave P5: formato inválido')
  }

  return result
}


export interface KeyPair extends IPrivateKeyData {
  role: HiveKeyRole
  // Hereda wifPrivateKey y associatedPublicKey de IPrivateKeyData
  privateKey: string // Alias para wifPrivateKey para compatibilidad
  publicKey: TPublicKey // Alias para associatedPublicKey para compatibilidad
}

/**
 * Interface legacy para claves de Hive (mantenida para compatibilidad)
 */
export interface HiveKeysLegacy {
  /** Brain key para backup/recuperación (16 palabras o P5 format) */
  /** Master private key (WIF) usada para derivar todas las claves */
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
   * Genera nuevas claves de Hive usando formato P5 personalizado
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
 * Genera claves de Hive usando formato P5 personalizado (función legacy)
 * Recomendado usar HiveKeys.generate() para nueva implementación
 *
 * @param accountName - Nombre de la cuenta de Hive
 * @returns Promise<HiveKeysLegacy> - Claves completas de Hive con formato P5
 */
export async function generateHiveKeys(
  accountName: string
): Promise<HiveKeysLegacy> {
  const hive = await getWaxFoundation()

  // Genera brain key como master usando WAX nativo
  const brainKeyData = hive.suggestBrainKey()
  const masterPrivateKey = brainKeyData.wifPrivateKey

  // Deriva claves para cada rol usando la master key
  const keys: KeyPair[] = (['owner', 'active', 'posting', 'memo'] as const).map(
    role => {
      const keyData = hive.getPrivateKeyFromPassword(
        accountName,
        role,
        masterPrivateKey
      )
      return {
        role,
        // Implementar IPrivateKeyData
        wifPrivateKey: keyData.wifPrivateKey,
        associatedPublicKey: keyData.associatedPublicKey,
        // Aliases para compatibilidad
        privateKey: keyData.wifPrivateKey,
        publicKey: keyData.associatedPublicKey as TPublicKey,
      }
    }
  return {
    masterPrivateKey,
    keys,
  }
}

/**
 * Valida que una clave pública tenga el formato correcto de Hive
 * Wrapper que usa la validación nativa de WAX
 *
 * @param publicKey - Clave pública a validar
 * @returns boolean - true si es válida, false si no
 */
export function isValidHivePublicKey(publicKey: TPublicKey): boolean {
  return isPublicKey(publicKey)
}

/**
 * Valida que una clave privada WIF tenga el formato correcto
 *
 * @param privateKey - Clave privada WIF a validar
 * @returns boolean - true si es válida, false si no
 */
export function isValidWifPrivateKey(privateKey: string): boolean {
  // Las claves privadas WIF empiezan con 5 y tienen longitud específica
  const wifKeyRegex = /^5[A-Za-z0-9]{50}$/
  return wifKeyRegex.test(privateKey)
}
