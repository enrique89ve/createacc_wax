/**
 * API: Verify ticket code availability
 *
 * Endpoint for builders that validates if a ticket code is available
 * before creating the ticket. Only verifies availability, does not validate format.
 *
 * GET /api/builders/tickets/check-code?code=ABC123
 */

import type { APIRoute } from 'astro'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { assertCanPerform, unauthorizedResponse } from '@/lib/admin/permissions-management'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { HTTP_STATUS } from '@/consts/constants'
import { apiSuccess, apiError } from '@/utils/errorResponse'

export const GET: APIRoute = async (context) => {
	return withBuilderApiSession(context, async (session) => {
		try {
			assertCanPerform(session, 'CREATE_TICKET', 'GET /api/builders/tickets/check-code')
		} catch {
			return unauthorizedResponse()
		}

		try {
			const code = context.url.searchParams.get('code')

			if (!code || !code.trim()) {
				return apiError('Código no especificado', HTTP_STATUS.BAD_REQUEST)
			}

			const ticketCode = code.trim().toUpperCase()

			const existingTicket = await ticketsRepository.findByCode(ticketCode)

			if (existingTicket) {
				return apiSuccess(
					{ available: false, message: 'El código ya está en uso' },
					HTTP_STATUS.OK
				)
			}

			return apiSuccess(
				{ available: true, message: 'Código disponible' },
				HTTP_STATUS.OK
			)
		} catch (error) {
			return apiError(
				'Error interno del servidor',
				HTTP_STATUS.INTERNAL_SERVER_ERROR
			)
		}
	})
}
