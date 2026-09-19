import { EManabarType, type IHiveChainInterface } from '@hiveio/wax'
import {
  PREFLIGHT_CHECK_STATUS,
  RC_PREFLIGHT_THRESHOLDS,
  type PreflightCheckStatus,
} from '@/consts/hive-execution'
import { ENV_KEYS } from '@/consts/constants'
import { getRequiredEnvString } from '@/lib/env'
import { isSimulationMode } from '@/lib/hive-execution-mode'
import { hiveChain } from '@/lib/hiveservice'
import { safeCheckAccountOnChain } from '@/utils/validate-hiveuser'
import {
  pushCreateClaimedAccount,
  type ICreateAccountParams,
} from '@/lib/create/create-account'

export interface PreflightCheck {
  readonly status: PreflightCheckStatus
  readonly message: string
  readonly detail?: string | number
}

export interface HivePreflightResult {
  readonly passed: boolean
  readonly claimedAccounts: number
  readonly rcPercent?: number
  readonly checks: {
    readonly rpc: PreflightCheck
    readonly creator: PreflightCheck
    readonly username: PreflightCheck
    readonly claimedAccounts: PreflightCheck
    readonly rc: PreflightCheck
    readonly wax: PreflightCheck
    readonly authority: PreflightCheck
  }
}

export class HivePreflightError extends Error {
  constructor(
    message: string,
    readonly result: HivePreflightResult
  ) {
    super(message)
    this.name = 'HivePreflightError'
  }
}

const NO_CLAIMED_ACCOUNTS_MESSAGE =
  'Creator account has no pending claimed accounts'

function check(
  status: PreflightCheckStatus,
  message: string,
  detail?: string | number
): PreflightCheck {
  return { status, message, detail }
}

function fail(message: string, detail?: string | number): PreflightCheck {
  return check(PREFLIGHT_CHECK_STATUS.FAIL, message, detail)
}

function pass(message: string, detail?: string | number): PreflightCheck {
  return check(PREFLIGHT_CHECK_STATUS.PASS, message, detail)
}

function warn(message: string, detail?: string | number): PreflightCheck {
  return check(PREFLIGHT_CHECK_STATUS.WARNING, message, detail)
}

function rcStatusFromPercent(percent: number): PreflightCheck {
  if (!Number.isFinite(percent) || percent <= 0) {
    return fail('Creator RC is zero or invalid', percent)
  }
  if (percent < RC_PREFLIGHT_THRESHOLDS.WARNING_PERCENT) {
    return warn('Creator RC is critically low', percent)
  }
  if (percent <= RC_PREFLIGHT_THRESHOLDS.PASS_PERCENT) {
    return warn('Creator RC is low', percent)
  }
  return pass('Creator RC available', percent)
}

async function lookupCreator(
  chain: IHiveChainInterface,
  creator: string
): Promise<{ exists: boolean; claimedAccounts: number }> {
  const result = await chain.api.database_api.find_accounts({
    accounts: [creator],
    delayed_votes_active: true,
  })
  const account = result.accounts[0]
  if (!account) return { exists: false, claimedAccounts: 0 }
  return {
    exists: true,
    claimedAccounts: Number(account.pending_claimed_accounts),
  }
}

async function lookupRcPercent(
  chain: IHiveChainInterface,
  creator: string
): Promise<number | undefined> {
  try {
    const manabar = await chain.calculateCurrentManabarValueForAccount(
      creator,
      EManabarType.RC
    )
    return manabar.percent
  } catch {
    return undefined
  }
}

async function checkWaxOperation(
  chain: IHiveChainInterface,
  params: ICreateAccountParams,
  creator: string
): Promise<{ wax: PreflightCheck; authority: PreflightCheck }> {
  try {
    const tx = await chain.createTransaction()
    pushCreateClaimedAccount(tx, params, creator)
    tx.validate()
    const required = tx.requiredAuthorities
    const hasActive = required.active.has(creator)
    return {
      wax: pass('WAX transaction validated'),
      authority: hasActive
        ? pass('Active authority required from creator')
        : fail('Creator active authority missing from transaction'),
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'WAX validation failed'
    return {
      wax: fail(message),
      authority: fail('Authority not evaluated'),
    }
  }
}

export async function runAccountCreationPreflight(
  params: ICreateAccountParams
): Promise<HivePreflightResult> {
  const creator = getRequiredEnvString(ENV_KEYS.HIVE_CREATOR_ACCOUNT)

  let chain: IHiveChainInterface
  try {
    chain = await hiveChain()
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Hive RPC unavailable'
    const failed = fail(message)
    const result: HivePreflightResult = {
      passed: false,
      claimedAccounts: 0,
      checks: {
        rpc: failed,
        creator: fail('Skipped'),
        username: fail('Skipped'),
        claimedAccounts: fail('Skipped'),
        rc: fail('Skipped'),
        wax: fail('Skipped'),
        authority: fail('Skipped'),
      },
    }
    throw new HivePreflightError('Hive RPC unavailable', result)
  }

  const rpc = pass('Hive RPC available', chain.endpointUrl)

  const [creatorLookup, usernameLookup] = await Promise.all([
    lookupCreator(chain, creator),
    safeCheckAccountOnChain({
      chain,
      accountName: params.username,
    }),
  ])

  const creatorCheck = creatorLookup.exists
    ? pass('Creator account exists', creator)
    : fail('Creator account does not exist', creator)
  let usernameCheck: PreflightCheck
  if (usernameLookup.status === 'error') {
    usernameCheck = fail(usernameLookup.message)
  } else if (usernameLookup.status === 'found') {
    usernameCheck = fail('Username already exists on Hive')
  } else {
    usernameCheck = pass('Username available on Hive')
  }

  const simulation = isSimulationMode()
  const claimedCount = creatorLookup.claimedAccounts
  const claimedCheck = !creatorLookup.exists
    ? fail('Skipped')
    : claimedCount > 0
      ? pass('Pending claimed accounts available', claimedCount)
      : simulation
        ? warn(
            `${NO_CLAIMED_ACCOUNTS_MESSAGE} (ignored in simulate mode)`,
            claimedCount
          )
        : fail(NO_CLAIMED_ACCOUNTS_MESSAGE, claimedCount)

  const [rcPercent, waxChecks] = creatorLookup.exists
    ? await Promise.all([
        lookupRcPercent(chain, creator),
        checkWaxOperation(chain, params, creator),
      ])
    : [undefined, { wax: fail('Skipped'), authority: fail('Skipped') } as const]

  const rcCheck = !creatorLookup.exists
    ? fail('Skipped')
    : rcPercent === undefined
      ? warn('Could not read creator RC')
      : rcStatusFromPercent(rcPercent)

  const blocking = [
    rpc,
    creatorCheck,
    usernameCheck,
    claimedCheck,
    rcCheck,
    waxChecks.wax,
    waxChecks.authority,
  ]
  const passed = blocking.every(
    item => item.status !== PREFLIGHT_CHECK_STATUS.FAIL
  )

  const result: HivePreflightResult = {
    passed,
    claimedAccounts: claimedCount,
    rcPercent,
    checks: {
      rpc,
      creator: creatorCheck,
      username: usernameCheck,
      claimedAccounts: claimedCheck,
      rc: rcCheck,
      wax: waxChecks.wax,
      authority: waxChecks.authority,
    },
  }

  if (!passed) {
    const failedCheck = blocking.find(
      item => item.status === PREFLIGHT_CHECK_STATUS.FAIL
    )
    throw new HivePreflightError(
      failedCheck?.message ?? 'Account creation preflight failed',
      result
    )
  }

  return result
}

export { NO_CLAIMED_ACCOUNTS_MESSAGE }
