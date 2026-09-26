import { obtainPowSolution, type PowSolution } from '@/utils/pow-solver'
import { POW_MAX_AGE_MS, ensureTimingMatured } from '@/utils/timing-maturation'
import { TIMING_THRESHOLDS } from '@/consts/pow'
import {
  TICKET_VALIDATION_ERROR_CODES,
  type TicketValidationErrorCode,
} from '@/consts/validation'
import { z } from 'astro/zod'
import { readApiResponse } from '@/utils/api-client'
import type { FormState } from './types'

const SessionResponseSchema = z.looseObject({ username: z.string() })

export type SessionCreationResult =
  | { readonly success: true }
  | {
      readonly success: false
      readonly reason: 'ticket_invalid'
      readonly ticketValidationErrorCode: TicketValidationErrorCode
    }
  | {
      readonly success: false
      readonly reason: 'rate_limited'
      readonly retryAfterSeconds?: number
    }
  | {
      readonly success: false
      readonly reason:
        | 'pow_invalid'
        | 'timing_invalid'
        | 'username_required'
        | 'service_unavailable'
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTicketValidationErrorCode(
  payload: unknown
): TicketValidationErrorCode | undefined {
  if (!isRecord(payload) || !isRecord(payload.details)) return undefined
  if (payload.details.kind !== 'ticket_validation') return undefined

  const code = payload.details.code
  return Object.values(TICKET_VALIDATION_ERROR_CODES).find(
    candidate => candidate === code
  )
}

function parseSessionValidationReason(
  payload: unknown
): 'pow_invalid' | 'timing_invalid' | 'username_required' | undefined {
  if (!isRecord(payload) || !isRecord(payload.details)) return undefined
  if (payload.details.kind !== 'session_validation') return undefined

  switch (payload.details.code) {
    case 'invalid_pow':
      return 'pow_invalid'
    case 'invalid_timing':
      return 'timing_invalid'
    case 'username_required':
      return 'username_required'
    default:
      return undefined
  }
}

export async function createSession(
  username: string,
  ticket: string,
  pow: PowSolution,
  timingTokenId: string
): Promise<SessionCreationResult> {
  let response: Response
  try {
    response = await fetch('/api/create/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, ticket, pow, timingTokenId }),
    })
  } catch {
    return { success: false, reason: 'service_unavailable' }
  }
  const parsedResponse = await readApiResponse(response, SessionResponseSchema)

  if (response.ok && parsedResponse.ok) {
    return { success: true }
  }

  if (response.status === 429) {
    const retryAfterSeconds = Number(response.headers.get('Retry-After'))
    return {
      success: false,
      reason: 'rate_limited',
      ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? { retryAfterSeconds }
        : {}),
    }
  }

  const errorBody =
    !parsedResponse.ok && parsedResponse.kind !== 'invalid_response'
      ? parsedResponse.body
      : undefined
  const ticketValidationErrorCode = parseTicketValidationErrorCode(errorBody)
  if (ticketValidationErrorCode) {
    return {
      success: false,
      reason: 'ticket_invalid',
      ticketValidationErrorCode,
    }
  }

  const sessionValidationReason = parseSessionValidationReason(errorBody)
  if (sessionValidationReason) {
    return { success: false, reason: sessionValidationReason }
  }

  return {
    success: false,
    reason: 'service_unavailable',
  }
}

export type ResolvedSubmitData =
  | {
      readonly status: 'resolved'
      readonly pow: PowSolution
      readonly timingTokenId: string
    }
  | { readonly status: 'pow_error' }
  | { readonly status: 'timing_error' }

export interface SubmitDeps {
  readonly state: FormState
  readonly ensureFlowTimingToken: () => Promise<string>
}

export async function resolveSubmitDependencies(
  deps: SubmitDeps
): Promise<ResolvedSubmitData> {
  const { state, ensureFlowTimingToken } = deps

  const isPowFresh =
    state.preSolvedPow && Date.now() - state.preSolvedPowAt < POW_MAX_AGE_MS
  let pow: PowSolution | null
  try {
    pow = isPowFresh ? await state.preSolvedPow : await obtainPowSolution()
  } catch {
    return { status: 'pow_error' }
  }
  state.preSolvedPow = null
  if (!pow) return { status: 'pow_error' }

  let timingTokenId: string
  try {
    timingTokenId = await ensureFlowTimingToken()
  } catch {
    return { status: 'timing_error' }
  }

  try {
    await ensureTimingMatured(
      state.flowTimingTokenFetchedAt,
      TIMING_THRESHOLDS.flow
    )
  } catch {
    return { status: 'timing_error' }
  }

  return { status: 'resolved', pow, timingTokenId }
}
