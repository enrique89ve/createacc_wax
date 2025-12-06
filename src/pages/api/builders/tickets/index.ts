/**
 * 🎫 BUILDERS API: TICKETS
 *
 * GET  /api/builders/tickets - Listar tickets del builder autenticado
 * POST /api/builders/tickets - Crear nuevo ticket
 */

import type { APIRoute } from 'astro'
import { HTTP_STATUS } from '@/consts/constants'
import {
	getAuthenticatedBuilderId,
	handleAuthError,
} from '@/lib/auth/builder-auth'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { creditsService } from '@/lib/credits-service'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import {
	validateTicketName,
	validateTicketCredits,
	validateTicketDescription,
} from '@/lib/validators/ticket-validator'
import { isValidationSuccess } from '@/utils/validation-result'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { requireValidOrigin } from '@/utils/csrf-protection'
import type {
	CreateTicketRequest,
	CreateTicketResponse,
} from '@/types/api-contracts'

/**
 * GET /api/builders/tickets
 * Listar todos los tickets del builder autenticado
 */
export const GET: APIRoute = async ({ request }) => {
	try {
		const builderId = await getAuthenticatedBuilderId(request)

		// Obtener tickets con información del creador
		const tickets = await ticketsRepository.getBuilderTicketsWithCreator(
			builderId
		)

		return apiSuccess(
			{
				tickets,
				total: tickets.length,
			},
			HTTP_STATUS.OK
		)
	} catch (error) {
		return handleAuthError(error)
	}
}

/**
 * POST /api/builders/tickets
 * Crear un nuevo ticket
 */
export const POST: APIRoute = async ({ request }) => {
	// CSRF Protection
	const csrfCheck = requireValidOrigin(request)
	if (csrfCheck) return csrfCheck

	try {
		const builderId = await getAuthenticatedBuilderId(request)

		const body: CreateTicketRequest = await request.json()
		const { code, credits, description } = body

		// Validar nombre del ticket
		const codeValidation = validateTicketName(code)
		if (!isValidationSuccess(codeValidation)) {
			return apiError(codeValidation.error.message, HTTP_STATUS.BAD_REQUEST)
		}

		// Validar créditos
		const creditsValidation = validateTicketCredits(credits)
		if (!isValidationSuccess(creditsValidation)) {
			return apiError(creditsValidation.error.message, HTTP_STATUS.BAD_REQUEST)
		}

		// Validar descripción (opcional)
		const descriptionValidation = validateTicketDescription(description)
		if (!isValidationSuccess(descriptionValidation)) {
			return apiError(descriptionValidation.error.message, HTTP_STATUS.BAD_REQUEST)
		}

		const ticketCode = codeValidation.data
		const ticketCredits = creditsValidation.data
		const ticketDescription = descriptionValidation.data

		// Verificar si el código ya existe
		const existingTicket = await ticketsRepository.findByCode(ticketCode)
		if (existingTicket) {
			return apiError(
				'Ya existe un ticket con ese código',
				HTTP_STATUS.CONFLICT
			)
		}

		// Verificar que el builder tenga suficientes créditos
		const validation = await creditBalanceTracker.validateOperation(
			builderId,
			'deduct',
			ticketCredits
		)

		if (!validation.valid) {
			return apiError(
				validation.reason || 'Operación inválida',
				HTTP_STATUS.BAD_REQUEST
			)
		}

		// Descontar créditos usando credits-service
		await creditsService.deductCreditsForTicket(
			builderId,
			ticketCredits,
			ticketCode
		)

		// Crear el ticket
		const createdTicket = await ticketsRepository.create({
			code: ticketCode,
			description: ticketDescription,
			original_credits: ticketCredits,
			credits: ticketCredits,
			created_by: builderId,
		})

		const response: CreateTicketResponse = {
			success: true,
			ticketId: createdTicket.id,
			code: createdTicket.code,
			credits: createdTicket.original_credits,
		}

		return apiSuccess(response, HTTP_STATUS.OK)
	} catch (error) {
		if (
			error instanceof Error &&
			(error.name === 'UnauthenticatedError' ||
				error.name === 'NotBuilderError')
		) {
			return handleAuthError(error)
		}

		console.error('Error creating ticket:', error)
		return apiError(
			'Error interno del servidor',
			HTTP_STATUS.INTERNAL_SERVER_ERROR
		)
	}
}
