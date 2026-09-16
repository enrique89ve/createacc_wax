/**
 * Types for Hive blockchain keys management
 */

export type HiveKeyRole = 'owner' | 'active' | 'posting' | 'memo'

/**
 * The only key material allowed to cross the network boundary.
 * Private keys must never appear on this object.
 */
export interface PublicKeySet {
	readonly ownerPublicKey: string
	readonly activePublicKey: string
	readonly postingPublicKey: string
	readonly memoPublicKey: string
}

export const PUBLIC_KEY_FIELD_NAMES = [
	'ownerPublicKey',
	'activePublicKey',
	'postingPublicKey',
	'memoPublicKey',
] as const

export const PRIVATE_KEY_FIELD_NAMES = [
	'masterPrivateKey',
	'privateKey',
	'wifPrivateKey',
	'masterKey',
	'privateKeys',
	'allKeys',
] as const

export type PrivateKeyFieldName = (typeof PRIVATE_KEY_FIELD_NAMES)[number]

export function hasForbiddenPrivateKeyFields(
	data: Record<string, unknown>
): boolean {
	return PRIVATE_KEY_FIELD_NAMES.some((name) =>
		Object.prototype.hasOwnProperty.call(data, name)
	)
}
