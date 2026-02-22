import type { APIRoute } from 'astro'
import type { CreationSession } from '@/types/auth'
import { HTTP_STATUS } from '@/consts/constants'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { CreationSessionManager } from '@/lib/session-cookies'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { checkCreationRateLimit, createRateLimitResponse } from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'
import { validatePowSolution, validateTimingToken } from '@/lib/pow'
import { TIMING_THRESHOLDS } from '@/consts/pow'

interface Body {
  readonly username?: string
  readonly ticket?: string
  readonly pow?: unknown
  readonly timingTokenId?: string
}

function parsePowSolution(raw: unknown): { challengeId: string; nonce: string } | null {
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
				undefined,
				{ noCache: true }
			)
		}

		// Validate timing token only when ticket is present (submit from Form.astro).
		// Without ticket = session refresh from ensureCreationSession() → skip timing.
		if (ticket && ticket.trim()) {
			if (!data.timingTokenId || !validateTimingToken(data.timingTokenId, TIMING_THRESHOLDS.session)) {
				return apiError(
					'Timing validation failed',
					HTTP_STATUS.BAD_REQUEST,
					undefined,
					{ noCache: true }
				)
			}
		}

		if (!username) {
			return apiError(
				VALIDATION_ERROR_MESSAGES.USERNAME_REQUIRED,
				HTTP_STATUS.BAD_REQUEST,
				undefined,
				{ noCache: true }
			)
		}

		const sessionManager = new CreationSessionManager(
			context.cookies,
			context.request
		)

		// Check if a session already exists
		const existingSession = sessionManager.get()

		if (existingSession && existingSession.username === username) {
			// If the request has NO ticket, preserve the complete session as is
			if (!ticket || !ticket.trim()) {
				return apiSuccess(
					{ username },
					HTTP_STATUS.OK,
					{ noCache: true }
				)
			}

			// If the request HAS a ticket, update session while preserving other fields
			const updatedSession: CreationSession = {
				...existingSession,
				ticket: ticket.trim(),
			}
			sessionManager.set(updatedSession)

			return apiSuccess(
				{ username },
				HTTP_STATUS.OK,
				{ noCache: true }
			)
		}

		// If no session exists, create a new one
		const sessionData: CreationSession = {
			username,
			confirmedDownload: false,
			// Only add ticket if it's not empty
			...(ticket && ticket.trim() && { ticket: ticket.trim() }),
		}

		sessionManager.set(sessionData)

		return apiSuccess(
			{ username },
			HTTP_STATUS.OK,
			{ noCache: true }
		)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Internal server error'
		return apiError(
			errorMessage,
			HTTP_STATUS.INTERNAL_SERVER_ERROR,
			undefined,
			{ noCache: true }
		)
	}
}
