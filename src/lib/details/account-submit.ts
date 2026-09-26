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
import { z } from 'astro/zod'
import { readApiResponse } from '@/utils/api-client'
import {
  ALL_ERROR_CODES,
  VALIDATION_ERROR_CODES,
  type UnifiedErrorCode,
} from '@/consts/unified-errors'

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
  | { readonly status: 'created'; readonly transactionId: string }
  | {
      readonly status: 'rejected'
      readonly httpStatus: number
      readonly errorCode?: UnifiedErrorCode
      readonly retryAfterSeconds?: number
    }
  | {
      readonly status: 'pending'
      readonly reason: 'reconciliation' | 'creation_in_progress'
      readonly correlationId?: string
    }
  | { readonly status: 'unknown' }

const AccountCreationResponseDataSchema = z
  .looseObject({
    status: z.string().optional(),
    transactionId: z.string().optional(),
    errorCode: z.string().optional(),
    correlationId: z.string().optional(),
    requiresReconciliation: z.boolean().optional(),
    broadcasted: z.boolean().optional(),
    chainConfirmed: z.boolean().optional(),
    databaseUpdated: z.boolean().optional(),
    isIdempotent: z.boolean().optional(),
  })
  .refine(
    data =>
      data.status === 'pending' ||
      typeof data.transactionId === 'string' ||
      data.isIdempotent === true
  )

function isUnifiedErrorCode(value: unknown): value is UnifiedErrorCode {
  return Object.values(ALL_ERROR_CODES).some(code => code === value)
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
  let response: Response
  try {
    response = await fetch('/api/create/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        ...publicKeys,
        pow,
        timingTokenId,
      }),
    })
  } catch {
    return { status: 'unknown' }
  }

  const parsedResponse = await readApiResponse(
    response,
    AccountCreationResponseDataSchema
  )
  const responseData = parsedResponse.ok
    ? parsedResponse.data
    : parsedResponse.kind === 'invalid_response'
      ? null
      : parsedResponse.body
  const result = isJsonObject(responseData) ? responseData : null
  const hasKnownSuccessEnvelope =
    parsedResponse.ok &&
    (parsedResponse.meta !== null || result?.success === true)

  const executionMayHaveStarted =
    result?.broadcasted === true ||
    result?.chainConfirmed === true ||
    result?.databaseUpdated === true
  const isPending =
    response.status === 202 ||
    result?.requiresReconciliation === true ||
    result?.errorCode === VALIDATION_ERROR_CODES.ACCOUNT_CREATION_IN_PROGRESS ||
    executionMayHaveStarted
  if (isPending) {
    return {
      status: 'pending',
      reason:
        result?.errorCode ===
        VALIDATION_ERROR_CODES.ACCOUNT_CREATION_IN_PROGRESS
          ? 'creation_in_progress'
          : 'reconciliation',
      ...(typeof result?.correlationId === 'string'
        ? { correlationId: result.correlationId }
        : {}),
    }
  }

  if (response.ok && hasKnownSuccessEnvelope && result?.status !== 'pending') {
    return {
      status: 'created',
      transactionId:
        typeof result?.transactionId === 'string' ? result.transactionId : '',
    }
  }

  if (
    response.status >= 500 ||
    (response.ok && !hasKnownSuccessEnvelope) ||
    (!parsedResponse.ok && parsedResponse.kind === 'invalid_response') ||
    !result
  ) {
    return { status: 'unknown' }
  }

  const retryAfterSeconds = Number(response.headers.get('Retry-After'))
  return {
    status: 'rejected',
    httpStatus: response.status,
    ...(isUnifiedErrorCode(result.errorCode)
      ? { errorCode: result.errorCode }
      : {}),
    ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? { retryAfterSeconds }
      : {}),
  }
}
