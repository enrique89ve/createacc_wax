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

function keyAuthsFromAuthority(authority: unknown): string[] {
	if (typeof authority !== 'object' || authority === null) return []
	if (!('key_auths' in authority)) return []
	const keyAuths = authority.key_auths
	if (Array.isArray(keyAuths)) {
		const keys: string[] = []
		for (const entry of keyAuths) {
			if (Array.isArray(entry) && typeof entry[0] === 'string') {
				keys.push(entry[0])
			}
		}
		return keys
	}
	if (typeof keyAuths === 'object' && keyAuths !== null) {
		return Object.keys(keyAuths)
	}
	return []
}

function soleKey(keys: readonly string[]): string | null {
	if (keys.length !== 1) return null
	const key = keys[0]
	return typeof key === 'string' ? key : null
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
	const ownerKey = soleKey(keyAuthsFromAuthority(record.owner))
	const activeKey = soleKey(keyAuthsFromAuthority(record.active))
	const postingKey = soleKey(keyAuthsFromAuthority(record.posting))
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
