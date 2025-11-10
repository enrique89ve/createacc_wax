import { isPublicKey, type TPublicKey } from '@hiveio/wax'

/**
 * Type guard que verifica si una clave pública es válida usando wax
 * Actualizado para usar pattern de type guard consistente
 * @param key - Clave a validar
 * @returns true si es válida y actúa como type guard
 */
export function checkPublicKeyFormat(key: unknown): key is string {
	return typeof key === 'string' && isPublicKey(key)
}

/**
 * Type guard específico para TPublicKey de Wax
 * Verifica que sea una clave pública válida con tipo específico
 * @param key - Clave a validar
 * @returns true si es TPublicKey válida
 */
export function isValidPublicKey(key: unknown): key is TPublicKey {
	// checkPublicKeyFormat ya incluye isPublicKey(), no necesitamos doble validación
	return checkPublicKeyFormat(key)
}

/**
 * Valida una clave pública y lanza error si no es válida
 * Función simple que lanza error - sin TypeScript avanzado
 * @param key - Clave a validar  
 * @param keyType - Tipo de clave (owner, active, etc.) para mensajes de error
 * @throws Error si la clave no es válida
 */
export function validatePublicKeyOrThrow(key: unknown, keyType?: string): void {
	if (!checkPublicKeyFormat(key)) {
		const keyName = keyType ? `${keyType} key` : 'key'
		throw new Error(`Invalid ${keyName}: ${JSON.stringify(key)}`)
	}
}

/**
 * Convierte una clave validada a TPublicKey
 * Cast simple después de validación - sin type guards complejos
 * @param key - Clave ya validada
 * @returns Clave con tipo correcto
 */
export function castToPublicKey(key: string): TPublicKey {
	return key as TPublicKey
}

/**
 * Interface para un set de claves públicas de Hive
 * Estructura clara y fácil de entender
 */
export interface PublicKeySet {
	readonly ownerPublicKey: unknown
	readonly activePublicKey: unknown
	readonly postingPublicKey: unknown
	readonly memoPublicKey: unknown
}

/**
 * Resultado de validación de claves - estructura simple
 */
export interface ValidatedKeySet {
	readonly ownerPublicKey: TPublicKey
	readonly activePublicKey: TPublicKey
	readonly postingPublicKey: TPublicKey
	readonly memoPublicKey: TPublicKey
}

/**
 * Valida un set completo de claves públicas de Hive
 * Lógica simple paso a paso - sin conceptos avanzados
 * @param keySet - Set de claves a validar
 * @returns Set validado con tipos correctos
 * @throws Error si alguna clave es inválida
 */
export function validateHiveKeySet(keySet: PublicKeySet): ValidatedKeySet {
	// Validar cada clave individualmente - paso a paso
	validatePublicKeyOrThrow(keySet.ownerPublicKey, 'owner')
	validatePublicKeyOrThrow(keySet.activePublicKey, 'active')
	validatePublicKeyOrThrow(keySet.postingPublicKey, 'posting')
	validatePublicKeyOrThrow(keySet.memoPublicKey, 'memo')

	// Si llegamos aquí, todas son válidas - convertir a tipos correctos
	return {
		ownerPublicKey: castToPublicKey(keySet.ownerPublicKey as string),
		activePublicKey: castToPublicKey(keySet.activePublicKey as string),
		postingPublicKey: castToPublicKey(keySet.postingPublicKey as string),
		memoPublicKey: castToPublicKey(keySet.memoPublicKey as string),
	}
}