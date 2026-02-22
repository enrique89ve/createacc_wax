/**
 * BUILDERS API: TICKETS
 *
 * GET  /api/builders/tickets - List authenticated builder tickets
 * POST /api/builders/tickets - Create new ticket
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { HTTP_STATUS } from '@/consts/constants'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { assertCanPerform, unauthorizedResponse } from '@/lib/admin/permissions-management'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { creditsService } from '@/lib/credits-service'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { withTransaction } from '@/lib/database'
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
export const GET: APIRoute = async (context) => {
	return withBuilderApiSession(context, async (session) => {
		try {
			assertCanPerform(session, 'VIEW_OWN_TICKETS', 'GET /api/builders/tickets')
		} catch {
			return unauthorizedResponse()
		}

		try {
			const tickets = await ticketsRepository.getBuilderTicketsWithCreator(
				session.userId
			)

			return apiSuccess(
				{
					tickets,
					total: tickets.length,
				},
				HTTP_STATUS.OK
			)
		} catch (error) {
			logger.error('Error listing tickets:', error)
			return apiError(
				'Error interno del servidor',
				HTTP_STATUS.INTERNAL_SERVER_ERROR
			)
		}
	})
}

/**
 * POST /api/builders/tickets
 * Create a new ticket
 */
export const POST: APIRoute = async (context) => {
	const csrfCheck = requireValidOrigin(context.request)
	if (csrfCheck) return csrfCheck

	return withBuilderApiSession(context, async (session) => {
		try {
			assertCanPerform(session, 'CREATE_TICKET', 'POST /api/builders/tickets')
		} catch {
			return unauthorizedResponse()
		}

		try {
			const body: CreateTicketRequest = await context.request.json()
			const { code, credits, description } = body

			const codeValidation = validateTicketName(code)
			if (!isValidationSuccess(codeValidation)) {
				return apiError(codeValidation.error.message, HTTP_STATUS.BAD_REQUEST)
			}

			const creditsValidation = validateTicketCredits(credits)
			if (!isValidationSuccess(creditsValidation)) {
				return apiError(creditsValidation.error.message, HTTP_STATUS.BAD_REQUEST)
			}

			const descriptionValidation = validateTicketDescription(description)
			if (!isValidationSuccess(descriptionValidation)) {
				return apiError(descriptionValidation.error.message, HTTP_STATUS.BAD_REQUEST)
			}

			const ticketCode = codeValidation.data
			const ticketCredits = creditsValidation.data
			const ticketDescription = descriptionValidation.data

			const existingTicket = await ticketsRepository.findByCode(ticketCode)
			if (existingTicket) {
				return apiError(
					'Ya existe un ticket con ese código',
					HTTP_STATUS.CONFLICT
				)
			}

			const validation = await creditBalanceTracker.validateOperation(
				session.userId,
				'deduct',
				ticketCredits
			)

			if (!validation.valid) {
				return apiError(
					validation.reason || 'Operación inválida',
					HTTP_STATUS.BAD_REQUEST
				)
			}

			const createdTicket = await withTransaction(async () => {
				await creditsService.deductCreditsForTicket(
					session.userId,
					ticketCredits,
					ticketCode
				)

				return ticketsRepository.create({
					code: ticketCode,
					description: ticketDescription,
					original_credits: ticketCredits,
					credits: ticketCredits,
					created_by: session.userId,
				})
			})

			const response: CreateTicketResponse = {
				success: true,
				ticketId: createdTicket.id,
				code: createdTicket.code,
				credits: createdTicket.original_credits,
			}

			return apiSuccess(response, HTTP_STATUS.OK)
		} catch (error) {
			logger.error('Error creating ticket:', error)
			return apiError(
				'Error interno del servidor',
				HTTP_STATUS.INTERNAL_SERVER_ERROR
			)
		}
	})
}
