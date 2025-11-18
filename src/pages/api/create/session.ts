import type { APIRoute } from 'astro'
import type { CreationSession } from '@/types/auth'
import { HTTP_STATUS } from '@/consts/constants'
import { VALIDATION_ERROR_MESSAGES } from '@/consts/validation'
import { CreationSessionManager } from '@/lib/session-manager'
import {
  createCompatibleSuccessResponse,
  createCompatibleErrorResponse
} from '@/utils/errorResponse'

interface Body {
  readonly username?: string
  readonly ticket?: string
}

export const POST: APIRoute = async context => {
	try {
		const data: Body = await context.request.json()
		const { username, ticket } = data

		// Log para rastrear el ticket

		if (!username) {
			return createCompatibleErrorResponse(
				new Error(VALIDATION_ERROR_MESSAGES.USERNAME_REQUIRED),
				HTTP_STATUS.BAD_REQUEST,
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
				return createCompatibleSuccessResponse(
					{ success: true, username },
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

			return createCompatibleSuccessResponse(
				{ success: true, username },
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

		return createCompatibleSuccessResponse(
			{ success: true, username },
			HTTP_STATUS.OK,
			{ noCache: true }
		)
	} catch (error) {
		return createCompatibleErrorResponse(
			error,
			HTTP_STATUS.INTERNAL_SERVER_ERROR,
			{ noCache: true }
		)
	}
}
