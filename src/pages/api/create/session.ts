import type { APIRoute } from 'astro'
import type { CreationSession } from '@/types/auth'
import { HTTP_STATUS } from '@/consts/constants'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { CreationSessionManager } from '@/lib/session-manager'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { checkCreationRateLimit, createRateLimitResponse } from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'
import { validatePowSolution, validateTimingToken } from '@/lib/pow'
import { TIMING_THRESHOLDS } from '@/consts/pow'

interface Body {
  readonly username?: string
  readonly ticket?: string
  readonly pow?: { readonly challengeId?: string; readonly nonce?: string }
  readonly timingTokenId?: string
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
		if (!data.pow?.challengeId || !data.pow?.nonce || !validatePowSolution(data.pow as { challengeId: string; nonce: string })) {
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

		// Verificar si ya existe una sesión
		const existingSession = sessionManager.get()

		if (existingSession && existingSession.username === username) {
			// Si la petición NO tiene ticket, preservar la sesión completa tal como está
			if (!ticket || !ticket.trim()) {
				return apiSuccess(
					{ username },
					HTTP_STATUS.OK,
					{ noCache: true }
				)
			}

			// Si la petición SÍ tiene ticket, actualizar sesión preservando otros campos
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

		// Si no existe sesión, crear nueva
		const sessionData: CreationSession = {
			username,
			confirmedDownload: false,
			// Solo añadir ticket si no está vacío
			...(ticket && ticket.trim() && { ticket: ticket.trim() }),
		}

		sessionManager.set(sessionData)

		return apiSuccess(
			{ username },
			HTTP_STATUS.OK,
			{ noCache: true }
		)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : 'Error interno del servidor'
		return apiError(
			errorMessage,
			HTTP_STATUS.INTERNAL_SERVER_ERROR,
			undefined,
			{ noCache: true }
		)
	}
}
