import { obtainPowSolution, type PowSolution } from '@/utils/pow-solver'
import { POW_MAX_AGE_MS, ensureTimingMatured } from '@/utils/timing-maturation'
import { TIMING_THRESHOLDS } from '@/consts/pow'
import {
  TICKET_VALIDATION_ERROR_CODES,
  type TicketValidationErrorCode,
} from '@/consts/validation'
import type { FormState } from './types'

export type SessionCreationResult =
  | { readonly success: true }
  | {
      readonly success: false
      readonly error: string
      readonly ticketValidationErrorCode?: TicketValidationErrorCode
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

export async function createSession(
  username: string,
  ticket: string,
  pow: PowSolution,
  timingTokenId: string
): Promise<SessionCreationResult> {
  const response = await fetch('/api/create/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, ticket, pow, timingTokenId }),
  })
  let result: unknown
  try {
    result = await response.json()
  } catch {
    result = undefined
  }

  if (response.ok && isRecord(result) && result.success === true) {
    return { success: true }
  }

  return {
    success: false,
    error:
      isRecord(result) && typeof result.error === 'string'
        ? result.error
        : 'Error al crear la sesión',
    ticketValidationErrorCode: parseTicketValidationErrorCode(result),
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

  await ensureTimingMatured(
    state.flowTimingTokenFetchedAt,
    TIMING_THRESHOLDS.flow
  )

  return { status: 'resolved', pow, timingTokenId }
}
