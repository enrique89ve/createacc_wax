/**
 * BUILDERS API: TICKET BY ID
 *
 * PATCH  /api/builders/tickets/:id - Update ticket credits
 * DELETE /api/builders/tickets/:id - Delete a ticket
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { HTTP_STATUS } from '@/consts/constants'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { assertCanPerform, unauthorizedResponse } from '@/lib/auth/permissions'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { creditsService } from '@/lib/credits-service'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { withTransaction } from '@/lib/database'
import { validateCreditsDelta } from '@/lib/validators/ticket-validator'
import { isValidationSuccess } from '@/utils/validation-result'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { requireValidOrigin } from '@/utils/csrf-protection'
import type {
  UpdateTicketCreditsRequest,
  UpdateTicketCreditsResponse,
  DeleteTicketResponse,
} from '@/types/api-contracts'

/**
 * PATCH /api/builders/tickets/:id
 * Update ticket credits (add or reduce)
 */
export const PATCH: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withBuilderApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        'UPDATE_OWN_TICKET',
        'PATCH /api/builders/tickets/:id'
      )
    } catch {
      return unauthorizedResponse()
    }

    try {
      const ticketId = Number(context.params.id)
      if (!ticketId || isNaN(ticketId)) {
        return apiError('ID de ticket inválido', HTTP_STATUS.BAD_REQUEST)
      }

      const body: UpdateTicketCreditsRequest = await context.request.json()
      const { code, delta } = body

      const ticket = await ticketsRepository.findById(ticketId)

      if (!ticket) {
        return apiError('Ticket no encontrado', HTTP_STATUS.NOT_FOUND)
      }

      if (ticket.creator_username !== session.username) {
        return apiError(
          'No tienes permisos para modificar este ticket',
          HTTP_STATUS.FORBIDDEN
        )
      }

      if (ticket.code !== code) {
        return apiError('Código de ticket inválido', HTTP_STATUS.BAD_REQUEST)
      }

      const deltaValidation = validateCreditsDelta(ticket.credits, delta)
      if (!isValidationSuccess(deltaValidation)) {
        return apiError(deltaValidation.error.message, HTTP_STATUS.BAD_REQUEST)
      }

      const { newCredits } = deltaValidation.data

      if (delta > 0) {
        const validation = await creditBalanceTracker.validateOperation(
          session.username,
          'deduct',
          delta
        )

        if (!validation.valid) {
          return apiError(
            validation.reason || 'No tienes suficientes créditos disponibles',
            HTTP_STATUS.BAD_REQUEST
          )
        }
      }

      await withTransaction(async () => {
        if (delta > 0) {
          await creditsService.deductCreditsForTicket(
            session.username,
            delta,
            ticket.code
          )
        }

        if (delta < 0) {
          await creditsService.refundCreditsFromTicket(
            session.username,
            Math.abs(delta),
            ticket.code
          )
        }

        const updated = await ticketsRepository.updateOwned(
          ticketId,
          session.username,
          {
            credits: ticket.credits + delta,
            original_credits: newCredits,
          }
        )
        if (!updated) {
          throw new Error('Ticket ownership update rejected')
        }
      })

      const response: UpdateTicketCreditsResponse = {
        success: true,
        message: 'Ticket actualizado exitosamente',
        oldCredits: ticket.credits,
        newCredits: newCredits,
      }

      return apiSuccess(response, HTTP_STATUS.OK)
    } catch (error) {
      logger.error('Error updating ticket:', error)
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}

/**
 * DELETE /api/builders/tickets/:id
 * Delete a ticket (only if it has not been used)
 */
export const DELETE: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withBuilderApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        'DELETE_OWN_TICKET',
        'DELETE /api/builders/tickets/:id'
      )
    } catch {
      return unauthorizedResponse()
    }

    try {
      const ticketId = Number(context.params.id)
      if (!ticketId || isNaN(ticketId)) {
        return apiError('ID de ticket inválido', HTTP_STATUS.BAD_REQUEST)
      }

      const ticket = await ticketsRepository.findById(ticketId)

      if (!ticket) {
        return apiError('Ticket no encontrado', HTTP_STATUS.NOT_FOUND)
      }

      if (ticket.creator_username !== session.username) {
        return apiError(
          'No tienes permisos para eliminar este ticket',
          HTTP_STATUS.FORBIDDEN
        )
      }

      const creditsToRefund = ticket.has_been_used
        ? ticket.credits
        : ticket.original_credits

      await withTransaction(async () => {
        if (creditsToRefund > 0) {
          await creditsService.refundCreditsFromTicket(
            session.username,
            creditsToRefund,
            ticket.code
          )
        }

        const deleted = await ticketsRepository.deleteOwned(
          ticketId,
          session.username
        )
        if (!deleted) {
          throw new Error('Ticket ownership delete rejected')
        }
      })

      const response: DeleteTicketResponse = {
        success: true,
        message: ticket.has_been_used
          ? `Ticket eliminado. Se reembolsaron ${creditsToRefund} créditos restantes.`
          : 'Ticket eliminado exitosamente',
        refundedCredits: creditsToRefund,
      }

      return apiSuccess(response, HTTP_STATUS.OK)
    } catch (error) {
      logger.error('Error deleting ticket:', error)
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
