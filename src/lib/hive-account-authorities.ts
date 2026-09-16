import type { IHiveChainInterface } from '@hiveio/wax'
import { hiveChain } from '@/lib/hiveservice'

export interface ExpectedAccountKeys {
	readonly ownerPublicKey: string
	readonly activePublicKey: string
	readonly postingPublicKey: string
	readonly memoPublicKey: string
}

export interface HiveAccountAuthorities {
	readonly ownerKey: string
	readonly activeKey: string
	readonly postingKey: string
	readonly memoKey: string
}

export type HiveAuthorityLookup =
	| { readonly status: 'found'; readonly authorities: HiveAccountAuthorities }
	| { readonly status: 'not_found' }
	| { readonly status: 'error'; readonly message: string }
	| { readonly status: 'ambiguous' }

function isEmptyAccountAuths(value: unknown): boolean {
	if (value == null) return true
	if (Array.isArray(value)) return value.length === 0
	if (typeof value === 'object') return Object.keys(value).length === 0
	return false
}

function numericWeight(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : null
	}
	return null
}

function soleWeightedKey(keyAuths: unknown): { key: string; weight: number } | null {
	if (Array.isArray(keyAuths)) {
		if (keyAuths.length !== 1) return null
		const entry = keyAuths[0]
		if (!Array.isArray(entry) || typeof entry[0] !== 'string') return null
		const weight = numericWeight(entry[1])
		if (weight === null) return null
		return { key: entry[0], weight }
	}
	if (typeof keyAuths === 'object' && keyAuths !== null) {
		const keys = Object.keys(keyAuths)
		if (keys.length !== 1) return null
		const key = keys[0]
		if (!key) return null
		const weight = numericWeight((keyAuths as Record<string, unknown>)[key])
		if (weight === null) return null
		return { key, weight }
	}
	return null
}

function createdAccountAuthorityKey(authority: unknown): string | null {
	if (typeof authority !== 'object' || authority === null) return null
	const record = authority as Record<string, unknown>
	if (numericWeight(record.weight_threshold) !== 1) return null
	if (!isEmptyAccountAuths(record.account_auths)) return null
	const sole = soleWeightedKey(record.key_auths)
	if (!sole || sole.weight !== 1) return null
	return sole.key
}

function memoKeyFromAccount(account: Record<string, unknown>): string | null {
	const memo = account.memo_key
	return typeof memo === 'string' && memo.length > 0 ? memo : null
}

export function authoritiesFromHiveAccount(
	account: unknown
): HiveAccountAuthorities | null {
	if (typeof account !== 'object' || account === null) return null
	const record = account as Record<string, unknown>
	const ownerKey = createdAccountAuthorityKey(record.owner)
	const activeKey = createdAccountAuthorityKey(record.active)
	const postingKey = createdAccountAuthorityKey(record.posting)
	const memoKey = memoKeyFromAccount(record)
	if (!ownerKey || !activeKey || !postingKey || !memoKey) return null
	return { ownerKey, activeKey, postingKey, memoKey }
}

export function hiveAuthoritiesMatchExpected(
	authorities: HiveAccountAuthorities,
	expected: ExpectedAccountKeys
): boolean {
	return (
		authorities.ownerKey === expected.ownerPublicKey &&
		authorities.activeKey === expected.activePublicKey &&
		authorities.postingKey === expected.postingPublicKey &&
		authorities.memoKey === expected.memoPublicKey
	)
}

export async function fetchHiveAccountAuthorities(
	username: string,
	chain?: IHiveChainInterface
): Promise<HiveAuthorityLookup> {
	try {
		const hive = chain ?? (await hiveChain())
		const result = await hive.api.database_api.find_accounts({
			accounts: [username],
			delayed_votes_active: true,
		})
		const account = result.accounts[0]
		if (!account) return { status: 'not_found' }
		const authorities = authoritiesFromHiveAccount(account)
		if (!authorities) return { status: 'ambiguous' }
		return { status: 'found', authorities }
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown chain error'
		return { status: 'error', message }
	}
}
