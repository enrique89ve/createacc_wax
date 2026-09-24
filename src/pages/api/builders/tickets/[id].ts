/**
 * BUILDERS API: TICKET BY ID
 *
 * PATCH  /api/builders/tickets/:id - Update ticket uses
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
import { validateUsesDelta } from '@/lib/validators/ticket-validator'
import { isValidationSuccess } from '@/utils/validation-result'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { requireValidOrigin } from '@/utils/csrf-protection'
import type {
  UpdateTicketUsesRequest,
  UpdateTicketUsesResponse,
  DeleteTicketResponse,
} from '@/types/api-contracts'
import { archiveOwnedTicket } from '@/lib/tickets/archive-ticket'

/**
 * PATCH /api/builders/tickets/:id
 * Update ticket uses (add or reduce)
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

      const body: UpdateTicketUsesRequest = await context.request.json()
      const { code, delta } = body

      const mutation = await withTransaction(async () => {
        const ticket = await ticketsRepository.findById(ticketId)

        if (!ticket) {
          return apiError('Ticket no encontrado', HTTP_STATUS.NOT_FOUND)
        }

        if (
          ticket.funding_source !== 'builder_credits' ||
          ticket.owner_builder_username !== session.username
        ) {
          return apiError(
            'No tienes permisos para modificar este ticket',
            HTTP_STATUS.FORBIDDEN
          )
        }

        if (ticket.code !== code) {
          return apiError('Código de ticket inválido', HTTP_STATUS.BAD_REQUEST)
        }

        if (typeof body.revoked === 'boolean') {
          const updated = await ticketsRepository.updateOwned(
            ticketId,
            session.username,
            { revoked_at: body.revoked ? new Date().toISOString() : null }
          )
          if (!updated) {
            return apiError('Ticket no encontrado', HTTP_STATUS.NOT_FOUND)
          }
          return {
            kind: 'revocation' as const,
            revoked: body.revoked,
          }
        }

        if (typeof delta !== 'number') {
          return apiError(
            'Debe indicar un cambio de usos',
            HTTP_STATUS.BAD_REQUEST
          )
        }

        const deltaValidation = validateUsesDelta(
          ticket.remaining_uses,
          delta,
          ticket.total_uses
        )
        if (!isValidationSuccess(deltaValidation)) {
          return apiError(deltaValidation.error.message, HTTP_STATUS.BAD_REQUEST)
        }

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

        const updated = await ticketsRepository.updateOwnedUses(
          ticketId,
          session.username,
          delta
        )
        if (!updated) {
          throw new Error('Ticket ownership update rejected')
        }

        return {
          kind: 'uses' as const,
          oldUses: ticket.remaining_uses,
          newUses: updated.remaining_uses,
        }
      })

      if (mutation instanceof Response) return mutation

      if (mutation.kind === 'revocation') {
        return apiSuccess(
          {
            success: true,
            message: mutation.revoked ? 'Ticket revocado' : 'Ticket restaurado',
            revoked: mutation.revoked,
          },
          HTTP_STATUS.OK
        )
      }

      const response: UpdateTicketUsesResponse = {
        success: true,
        message: 'Ticket actualizado exitosamente',
        oldUses: mutation.oldUses,
        newUses: mutation.newUses,
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
 * Archive a ticket and refund its remaining Builder-funded uses.
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

      const mutation = await archiveOwnedTicket(ticketId, session.username)
      if (mutation.kind === 'not_found') {
        return apiError('Ticket no encontrado', HTTP_STATUS.NOT_FOUND)
      }
      if (mutation.kind === 'open_attempts') {
        return apiError(
          'El ticket tiene creaciones en curso y no puede archivarse todavía',
          HTTP_STATUS.CONFLICT
        )
      }

      const response: DeleteTicketResponse = {
        success: true,
        message:
          mutation.kind === 'already_archived'
            ? `El ticket ya estaba archivado; el reembolso total fue de ${mutation.ticket.retired_uses} créditos`
            : `Ticket archivado; se reembolsaron ${mutation.ticket.retired_uses} créditos`,
        refundedCredits: mutation.ticket.retired_uses,
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
