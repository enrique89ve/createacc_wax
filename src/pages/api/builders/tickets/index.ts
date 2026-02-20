/**
 * 🎫 BUILDERS API: TICKETS
 *
 * GET  /api/builders/tickets - List authenticated builder tickets
 * POST /api/builders/tickets - Create new ticket
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
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
 * List all tickets of the authenticated builder
 */
export const GET: APIRoute = async ({ request }) => {
	try {
		const builderId = await getAuthenticatedBuilderId(request)

		// Get tickets with creator information
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
 * Create a new ticket
 */
export const POST: APIRoute = async ({ request }) => {
	// CSRF Protection
	const csrfCheck = requireValidOrigin(request)
	if (csrfCheck) return csrfCheck

	try {
		const builderId = await getAuthenticatedBuilderId(request)

		const body: CreateTicketRequest = await request.json()
		const { code, credits, description } = body

		// Validate ticket name
		const codeValidation = validateTicketName(code)
		if (!isValidationSuccess(codeValidation)) {
			return apiError(codeValidation.error.message, HTTP_STATUS.BAD_REQUEST)
		}

		// Validate credits
		const creditsValidation = validateTicketCredits(credits)
		if (!isValidationSuccess(creditsValidation)) {
			return apiError(creditsValidation.error.message, HTTP_STATUS.BAD_REQUEST)
		}

		// Validate description (optional)
		const descriptionValidation = validateTicketDescription(description)
		if (!isValidationSuccess(descriptionValidation)) {
			return apiError(descriptionValidation.error.message, HTTP_STATUS.BAD_REQUEST)
		}

		const ticketCode = codeValidation.data
		const ticketCredits = creditsValidation.data
		const ticketDescription = descriptionValidation.data

		// Verify if the code already exists
		const existingTicket = await ticketsRepository.findByCode(ticketCode)
		if (existingTicket) {
			return apiError(
				'Ya existe un ticket con ese código',
				HTTP_STATUS.CONFLICT
			)
		}

		// Verify that the builder has enough credits
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

		// Deduct credits using credits-service
		await creditsService.deductCreditsForTicket(
			builderId,
			ticketCredits,
			ticketCode
		)

		// Create the ticket
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

		logger.error('Error creating ticket:', error)
		return apiError(
			'Error interno del servidor',
			HTTP_STATUS.INTERNAL_SERVER_ERROR
		)
	}
}
