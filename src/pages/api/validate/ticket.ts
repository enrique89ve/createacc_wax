import type { APIRoute } from 'astro'
import { validateTicketInDB } from '@/utils/db-ticket-validator'
import { resolveClientIp } from '@/lib/client-ip'
import { checkCreationRateLimit } from '@/lib/creation-rate-limiter'
import { validatePowSolution, validateTimingToken } from '@/lib/pow'
import { TIMING_THRESHOLDS } from '@/consts/pow'
import { z } from 'astro/zod'
import { apiError, apiSuccess, createJsonResponse } from '@/utils/errorResponse'
import { HTTP_STATUS } from '@/consts/constants'

const TicketValidationRequestSchema = z.looseObject({
  ticket: z.unknown().optional(),
  pow: z.looseObject({
    challengeId: z.string().min(1),
    nonce: z.string().min(1),
  }),
  timingTokenId: z.string().min(1).optional(),
})

/**
 * F5c FIX: Response only returns { valid: boolean } - no ticket code/description.
 * F7 FIX: Cache-Control: no-store on all responses.
 * F8 FIX: Rate-limit via centralized creation-rate-limiter (5 req per 60s per IP).
 */

export const POST: APIRoute = async context => {
  try {
    const clientIp = resolveClientIp(context)
    const rateLimit = checkCreationRateLimit('ticket', clientIp)
    if (!rateLimit.allowed) {
      const retryAfterSeconds = Math.ceil(rateLimit.retryAfterMs / 1000)
      return createJsonResponse(
        {
          success: false,
          error: 'Too many requests. Please try again later.',
          valid: false,
        },
        HTTP_STATUS.TOO_MANY_REQUESTS,
        { headers: { 'Retry-After': String(retryAfterSeconds) } }
      )
    }

    let rawBody: unknown
    try {
      rawBody = await context.request.json()
    } catch {
      return createJsonResponse(
        {
          success: false,
          error: 'The request body must contain valid JSON.',
          valid: false,
        },
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const parsedBody = TicketValidationRequestSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return createJsonResponse(
        {
          success: false,
          error: 'The ticket, proof of work or timing token is invalid.',
          valid: false,
        },
        HTTP_STATUS.BAD_REQUEST
      )
    }
    const data = parsedBody.data

    // Validate PoW before any business logic
    if (!validatePowSolution(data.pow)) {
      return createJsonResponse(
        {
          success: false,
          error: 'Proof of work validation failed.',
          valid: false,
        },
        HTTP_STATUS.BAD_REQUEST
      )
    }

    // Validate timing token (anti-bot: user must spend minimum time on page)
    if (
      !data.timingTokenId ||
      !validateTimingToken(data.timingTokenId, TIMING_THRESHOLDS.ticket)
    ) {
      return createJsonResponse(
        {
          success: false,
          error: 'Timing validation failed.',
          valid: false,
        },
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const { ticket } = data

    if (!ticket || typeof ticket !== 'string') {
      return createJsonResponse(
        {
          success: false,
          error: 'Ticket is required.',
          valid: false,
        },
        HTTP_STATUS.BAD_REQUEST
      )
    }

    const validation = await validateTicketInDB(ticket)

    if (!validation.isValid) {
      return apiSuccess({ valid: false })
    }

    // F5c FIX: Only return validity, not ticket code/description
    return apiSuccess({ valid: true })
  } catch {
    return apiError(
      'Ticket validation is temporarily unavailable.',
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      {
        valid: false,
      }
    )
  }
}
