/**
 * 🎫 BUILDERS API: TICKET BY ID
 *
 * PATCH  /api/builders/tickets/:id - Update ticket credits
 * DELETE /api/builders/tickets/:id - Delete a ticket
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
import { validateCreditsDelta } from '@/lib/validators/ticket-validator'
import { isValidationSuccess } from '@/utils/validation-result'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import type {
  UpdateTicketCreditsRequest,
  UpdateTicketCreditsResponse,
  DeleteTicketResponse,
} from '@/types/api-contracts'

/**
 * PATCH /api/builders/tickets/:id
 * Update ticket credits (add or reduce)
 */
export const PATCH: APIRoute = async ({ request, params }) => {
  try {
    const builderId = await getAuthenticatedBuilderId(request)

    const ticketId = Number(params.id)
    if (!ticketId || isNaN(ticketId)) {
      return apiError('ID de ticket inválido', HTTP_STATUS.BAD_REQUEST)
    }

    const body: UpdateTicketCreditsRequest = await request.json()
    const { code, delta } = body

    // Validate that the ticket exists and belongs to the builder
    const ticket = await ticketsRepository.findById(ticketId)

    if (!ticket) {
      return apiError('Ticket no encontrado', HTTP_STATUS.NOT_FOUND)
    }

    if (ticket.created_by !== builderId) {
      return apiError(
        'No tienes permisos para modificar este ticket',
        HTTP_STATUS.FORBIDDEN
      )
    }

    // Verify that the code matches (additional security)
    if (ticket.code !== code) {
      return apiError('Código de ticket inválido', HTTP_STATUS.BAD_REQUEST)
    }

    // Validate delta (validate against current credits, not original ones)
    const deltaValidation = validateCreditsDelta(ticket.credits, delta)
    if (!isValidationSuccess(deltaValidation)) {
      return apiError(deltaValidation.error.message, HTTP_STATUS.BAD_REQUEST)
    }

    const { newCredits } = deltaValidation.data

    // If delta is positive, verify available builder credits
    if (delta > 0) {
      const validation = await creditBalanceTracker.validateOperation(
        builderId,
        'deduct',
        delta
      )

      if (!validation.valid) {
        return apiError(
          validation.reason || 'No tienes suficientes créditos disponibles',
          HTTP_STATUS.BAD_REQUEST
        )
      }

      // Deduct credits from builder
      await creditsService.deductCreditsForTicket(builderId, delta, ticket.code)
    }

    // If delta is negative, return credits to builder
    if (delta < 0) {
      // Refund credits to builder
      await creditsService.refundCreditsFromTicket(
        builderId,
        Math.abs(delta),
        ticket.code
      )
    }

    // Update the ticket
    await ticketsRepository.update(ticketId, {
      credits: ticket.credits + delta,
      original_credits: newCredits,
    })

    const response: UpdateTicketCreditsResponse = {
      success: true,
      message: 'Ticket actualizado exitosamente',
      oldCredits: ticket.credits,
      newCredits: newCredits,
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

    logger.error('Error updating ticket:', error)
    return apiError(
      'Error interno del servidor',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}

/**
 * DELETE /api/builders/tickets/:id
 * Delete a ticket (only if it has not been used)
 */
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const builderId = await getAuthenticatedBuilderId(request)

    const ticketId = Number(params.id)
    if (!ticketId || isNaN(ticketId)) {
      return apiError('ID de ticket inválido', HTTP_STATUS.BAD_REQUEST)
    }

    // Verify that the ticket exists and belongs to the builder
    const ticket = await ticketsRepository.findById(ticketId)

    if (!ticket) {
      return apiError('Ticket no encontrado', HTTP_STATUS.NOT_FOUND)
    }

    if (ticket.created_by !== builderId) {
      return apiError(
        'No tienes permisos para eliminar este ticket',
        HTTP_STATUS.FORBIDDEN
      )
    }

    // Calculate credits to refund:
    // - If the ticket was NOT used: refund original credits
    // - If the ticket WAS used: refund only the remaining credits (not the consumed ones)
    const creditsToRefund = ticket.has_been_used
      ? ticket.credits // Only the remaining credits
      : ticket.original_credits // All the original credits

    // Refund credits to builder (if there are credits to refund)
    if (creditsToRefund > 0) {
      await creditsService.refundCreditsFromTicket(
        builderId,
        creditsToRefund,
        ticket.code
      )
    }

    // Delete the ticket
    await ticketsRepository.delete(ticketId)

    const response: DeleteTicketResponse = {
      success: true,
      message: ticket.has_been_used
        ? `Ticket eliminado. Se reembolsaron ${creditsToRefund} créditos restantes.`
        : 'Ticket eliminado exitosamente',
      refundedCredits: creditsToRefund,
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

    logger.error('Error deleting ticket:', error)
    return apiError(
      'Error interno del servidor',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
