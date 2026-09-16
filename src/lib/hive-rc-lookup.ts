import type { IHiveChainInterface } from '@hiveio/wax'
import { hiveChain } from '@/lib/hiveservice'
import { ENV_KEYS, HIVE_CHAIN_CONFIG } from '@/consts/constants'
import { getEnvString } from '@/lib/env'
import { shouldTriggerWaxFailover } from '@/lib/wax-error-utils'

export type RcDelegationLookup =
	| { readonly status: 'found' }
	| { readonly status: 'not_found' }
	| { readonly status: 'error'; readonly message: string }

interface ListRcDirectDelegationsParams {
	readonly start: readonly [string, string]
	readonly limit: number
}

interface RcDirectDelegationRow {
	readonly from: string
	readonly to: string
	readonly delegated_rc: string | number
}

interface ListRcDirectDelegationsResult {
	readonly rc_direct_delegations: readonly RcDirectDelegationRow[]
}

/**
 * WAX 2.0.2 types only ship rc_api.find_rc_accounts.
 * IHiveChainInterface.extend adds undeclared JSON-RPC methods without casts.
 */
type RcDirectDelegationApi = {
	readonly rc_api: {
		readonly list_rc_direct_delegations: {
			readonly params: ListRcDirectDelegationsParams
			readonly result: ListRcDirectDelegationsResult
		}
	}
}

function withRcDirectDelegationApi(chain: IHiveChainInterface) {
	return chain.extend<RcDirectDelegationApi>()
}

function hasPositiveDelegation(
	rows: readonly RcDirectDelegationRow[],
	from: string,
	to: string
): boolean {
	return rows.some((row) => {
		if (row.from !== from || row.to !== to) return false
		const amount = Number(row.delegated_rc)
		return Number.isFinite(amount) && amount > 0
	})
}

function backupEndpoints(current: string): readonly string[] {
	return HIVE_CHAIN_CONFIG.MAINNET_BACKUPS.filter(url => url !== current)
}

async function listRcDirectDelegations(
	chain: IHiveChainInterface,
	from: string,
	to: string
): Promise<ListRcDirectDelegationsResult> {
	const extended = withRcDirectDelegationApi(chain)
	const params: ListRcDirectDelegationsParams = {
		start: [from, to],
		limit: 1,
	}
	try {
		return await extended.api.rc_api.list_rc_direct_delegations(params)
	} catch (error) {
		if (!shouldTriggerWaxFailover(error)) throw error
		const previous = extended.api.rc_api.endpointUrl
		try {
			for (const url of backupEndpoints(chain.endpointUrl)) {
				extended.api.rc_api.endpointUrl = url
				try {
					return await extended.api.rc_api.list_rc_direct_delegations(params)
				} catch (backupError) {
					if (!shouldTriggerWaxFailover(backupError)) throw backupError
				}
			}
		} finally {
			extended.api.rc_api.endpointUrl = previous
		}
		throw error
	}
}

export async function fetchRcDelegationExists(
	delegatee: string,
	chain?: IHiveChainInterface
): Promise<RcDelegationLookup> {
	const from = getEnvString(ENV_KEYS.HIVE_DELEGATOR_ACCOUNT)
	if (!from) {
		return { status: 'error', message: 'Missing delegator account' }
	}
	try {
		const hive = chain ?? (await hiveChain())
		const result = await listRcDirectDelegations(hive, from, delegatee)
		if (hasPositiveDelegation(result.rc_direct_delegations, from, delegatee)) {
			return { status: 'found' }
		}
		return { status: 'not_found' }
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown chain error'
		return { status: 'error', message }
	}
}
