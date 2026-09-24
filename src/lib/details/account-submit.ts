import {
  obtainPowSolution,
  fetchTimingToken,
  type PowSolution,
} from '@/utils/pow-solver'
import { TIMING_FLOOR_MS } from '@/consts/pow'
import { POW_MAX_AGE_MS, ensureTimingMatured } from '@/utils/timing-maturation'
import type { PublicKeySet } from '@/types/keys'
import type { PreSolvedBundle } from './types'
import { isJsonObject } from '@/utils/http-input'

interface ResolvedPow {
  readonly pow: PowSolution
  readonly timingTokenId: string
}

/**
 * Resolve PoW + timing token from a pre-solved bundle or fetch fresh ones.
 */
export async function resolvePow(
  preSolvedBundle: Promise<PreSolvedBundle | null> | null
): Promise<ResolvedPow> {
  const rawBundle = preSolvedBundle ? await preSolvedBundle : null
  const bundle =
    rawBundle && Date.now() - rawBundle.solvedAt < POW_MAX_AGE_MS
      ? rawBundle
      : null

  if (bundle) {
    if (!bundle.timingTokenId) {
      throw new Error('Timing token missing from pre-solved bundle')
    }
    await ensureTimingMatured(bundle.tokenFetchedAt, TIMING_FLOOR_MS, 0)
    return { pow: bundle.pow, timingTokenId: bundle.timingTokenId }
  }

  let tokenFetchedAt = 0
  const [pow, timingTokenId] = await Promise.all([
    obtainPowSolution(),
    fetchTimingToken()
      .then(id => {
        tokenFetchedAt = Date.now()
        return id
      })
      .catch(() => {
        tokenFetchedAt = Date.now()
        return undefined
      }),
  ])

  if (!timingTokenId) {
    throw new Error('Failed to obtain timing token')
  }

  await ensureTimingMatured(tokenFetchedAt, TIMING_FLOOR_MS, 0)
  return { pow, timingTokenId }
}

export type AccountCreationResult =
  | { readonly success: true; readonly transactionId: string }
  | {
      readonly success: false
      readonly error: string
      readonly requiresReconciliation: boolean
      readonly correlationId?: string
    }

/**
 * Call the account creation API endpoint.
 */
export async function submitAccountCreation(
  username: string,
  publicKeys: PublicKeySet,
  pow: PowSolution,
  timingTokenId: string
): Promise<AccountCreationResult> {
  const response = await fetch('/api/create/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      ...publicKeys,
      pow,
      timingTokenId,
    }),
  })

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  const result = isJsonObject(payload) ? payload : null

  if (response.ok && result?.success === true) {
    return {
      success: true,
      transactionId:
        typeof result.transactionId === 'string' ? result.transactionId : '',
    }
  }

  const requiresReconciliation = result?.requiresReconciliation === true
  return {
    success: false,
    error:
      typeof result?.error === 'string'
        ? result.error
        : 'Error al crear la cuenta',
    requiresReconciliation,
    ...(requiresReconciliation && typeof result?.correlationId === 'string'
      ? { correlationId: result.correlationId }
      : {}),
  }
}
