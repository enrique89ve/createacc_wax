import type { APIRoute } from 'astro'
import type { CreationSession } from '@/types/auth'
import { HTTP_STATUS } from '@/consts/constants'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { CreationSessionManager } from '@/lib/session-cookies'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import {
  checkCreationRateLimit,
  createRateLimitResponse,
} from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'
import { validatePowSolution, validateTimingToken } from '@/lib/pow'
import { TIMING_THRESHOLDS } from '@/consts/pow'
import { validateTicketInDB } from '@/utils/db-ticket-validator'

interface Body {
  readonly username?: string
  readonly ticket?: string
  readonly pow?: unknown
  readonly timingTokenId?: string
}

function parsePowSolution(
  raw: unknown
): { challengeId: string; nonce: string } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.challengeId !== 'string' || !obj.challengeId) return null
  if (typeof obj.nonce !== 'string' || !obj.nonce) return null
  return { challengeId: obj.challengeId, nonce: obj.nonce }
}

export const POST: APIRoute = async context => {
  try {
    // F3 FIX: Rate-limit session creation
    const clientIp = resolveClientIp(context)
    const rateLimit = checkCreationRateLimit('session', clientIp)
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit.retryAfterMs)
    }

    const data: Body = await context.request.json()
    const { username, ticket } = data

    // Validate PoW before any business logic
    const pow = parsePowSolution(data.pow)
    if (!pow || !validatePowSolution(pow)) {
      return apiError(
        'Proof of work validation failed',
        HTTP_STATUS.BAD_REQUEST,
        { kind: 'session_validation', code: 'invalid_pow' },
        { noCache: true }
      )
    }

    // Validate timing token only when ticket is present (submit from Form.astro).
    // Without ticket = session refresh from ensureCreationSession() → skip timing.
    if (ticket && ticket.trim()) {
      if (
        !data.timingTokenId ||
        !validateTimingToken(data.timingTokenId, TIMING_THRESHOLDS.flow)
      ) {
        return apiError(
          'Timing validation failed',
          HTTP_STATUS.BAD_REQUEST,
          { kind: 'session_validation', code: 'invalid_timing' },
          { noCache: true }
        )
      }
    }

    if (!username) {
      return apiError(
        VALIDATION_ERROR_MESSAGES.USERNAME_REQUIRED,
        HTTP_STATUS.BAD_REQUEST,
        { kind: 'session_validation', code: 'username_required' },
        { noCache: true }
      )
    }

    const sessionManager = new CreationSessionManager(
      context.cookies,
      context.request
    )

    // Check if a session already exists
    const existingSession = sessionManager.get()

    const normalizedTicket = ticket?.trim().toUpperCase() ?? ''

    if (existingSession && existingSession.username === username) {
      if (!normalizedTicket) {
        return apiSuccess({ username }, HTTP_STATUS.OK, { noCache: true })
      }

      const ticketValidation = await validateTicketInDB(normalizedTicket)
      if (!ticketValidation.isValid) {
        return apiError(
          ticketValidation.error ?? VALIDATION_ERROR_MESSAGES.TICKET_INVALID,
          HTTP_STATUS.BAD_REQUEST,
          {
            kind: 'ticket_validation',
            code: ticketValidation.errorCode,
          },
          { noCache: true }
        )
      }

      const updatedSession: CreationSession = {
        ...existingSession,
        ticket: normalizedTicket,
      }
      sessionManager.set(updatedSession)

      return apiSuccess({ username }, HTTP_STATUS.OK, { noCache: true })
    }

    if (normalizedTicket) {
      const ticketValidation = await validateTicketInDB(normalizedTicket)
      if (!ticketValidation.isValid) {
        return apiError(
          ticketValidation.error ?? VALIDATION_ERROR_MESSAGES.TICKET_INVALID,
          HTTP_STATUS.BAD_REQUEST,
          {
            kind: 'ticket_validation',
            code: ticketValidation.errorCode,
          },
          { noCache: true }
        )
      }
    }

    const sessionData: CreationSession = {
      username,
      confirmedDownload: false,
      ...(normalizedTicket && { ticket: normalizedTicket }),
    }

    sessionManager.set(sessionData)

    return apiSuccess({ username }, HTTP_STATUS.OK, { noCache: true })
  } catch (error) {
    console.error('[create-session] Session creation failed', error)
    return apiError(
      'Session creation failed',
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      undefined,
      { noCache: true }
    )
  }
}
