import type { IHiveChainInterface } from '@hiveio/wax'
import { hiveChain } from '@/lib/hiveservice'
import { ENV_KEYS } from '@/consts/constants'

export type RcDelegationLookup =
	| { readonly status: 'found' }
	| { readonly status: 'not_found' }
	| { readonly status: 'error'; readonly message: string }

interface RcDirectDelegation {
	readonly from?: unknown
	readonly to?: unknown
	readonly delegated_rc?: unknown
}

function parseDelegations(payload: unknown): RcDirectDelegation[] {
	if (typeof payload !== 'object' || payload === null) return []
	if (!('rc_direct_delegations' in payload)) return []
	const rows = payload.rc_direct_delegations
	if (!Array.isArray(rows)) return []
	return rows.filter((row): row is RcDirectDelegation => typeof row === 'object' && row !== null)
}

function hasDelegation(
	rows: readonly RcDirectDelegation[],
	from: string,
	to: string
): boolean {
	return rows.some((row) => {
		if (row.from !== from || row.to !== to) return false
		const amount = Number(row.delegated_rc)
		return Number.isFinite(amount) && amount > 0
	})
}

export async function fetchRcDelegationExists(
	delegatee: string,
	chain?: IHiveChainInterface
): Promise<RcDelegationLookup> {
	const from = process.env[ENV_KEYS.HIVE_DELEGATOR_ACCOUNT]
	if (!from) {
		return { status: 'error', message: 'Missing delegator account' }
	}
	try {
		const hive = chain ?? (await hiveChain())
		const rcApi = hive.api.rc_api as unknown as {
			list_rc_direct_delegations?: (params: {
				start: [string, string]
				limit: number
			}) => Promise<unknown>
		}
		if (typeof rcApi.list_rc_direct_delegations !== 'function') {
			return { status: 'error', message: 'rc_api.list_rc_direct_delegations unavailable' }
		}
		const result = await rcApi.list_rc_direct_delegations({
			start: [from, delegatee],
			limit: 1,
		})
		if (hasDelegation(parseDelegations(result), from, delegatee)) {
			return { status: 'found' }
		}
		return { status: 'not_found' }
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown chain error'
		return { status: 'error', message }
	}
}
