import type { IHiveChainInterface } from '@hiveio/wax'
import { hiveChain } from '@/lib/hiveservice'
import {
  ENV_KEYS,
  HIVE_CHAIN_CONFIG,
  RC_DELEGATION_AMOUNT,
} from '@/consts/constants'
import { getEnvString } from '@/lib/env'
import { shouldTriggerWaxFailover } from '@/lib/wax-error-utils'

export type RcDelegationLookup =
  | { readonly status: 'found'; readonly delegatedRc: bigint }
  | { readonly status: 'not_found' }
  | { readonly status: 'mismatch'; readonly delegatedRc: bigint }
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

function parseDelegatedRc(value: string | number): bigint | null {
  try {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
    if (typeof value === 'string' && value.trim() === '') return null
    return BigInt(value)
  } catch {
    return null
  }
}

function classifyDelegation(
  rows: readonly RcDirectDelegationRow[],
  from: string,
  to: string,
  expectedRc: bigint
): RcDelegationLookup {
  const match = rows.find(row => row.from === from && row.to === to)
  if (!match) return { status: 'not_found' }
  const amount = parseDelegatedRc(match.delegated_rc)
  if (amount === null) {
    return { status: 'error', message: 'Malformed delegated_rc' }
  }
  if (amount === expectedRc) return { status: 'found', delegatedRc: amount }
  return { status: 'mismatch', delegatedRc: amount }
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
    return classifyDelegation(
      result.rc_direct_delegations,
      from,
      delegatee,
      BigInt(RC_DELEGATION_AMOUNT)
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown chain error'
    return { status: 'error', message }
  }
}
