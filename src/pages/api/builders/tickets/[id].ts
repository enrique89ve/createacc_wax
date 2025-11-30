/**
 * 🎫 BUILDERS API: TICKET BY ID
 *
 * PATCH  /api/builders/tickets/:id - Actualizar créditos de un ticket
 * DELETE /api/builders/tickets/:id - Eliminar un ticket
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
 * Actualizar créditos de un ticket (agregar o reducir)
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

    // Validar que el ticket existe y pertenece al builder
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

    // Verificar que el código coincide (seguridad adicional)
    if (ticket.code !== code) {
      return apiError('Código de ticket inválido', HTTP_STATUS.BAD_REQUEST)
    }

    // Validar delta (validar contra créditos actuales, no originales)
    const deltaValidation = validateCreditsDelta(ticket.credits, delta)
    if (!isValidationSuccess(deltaValidation)) {
      return apiError(deltaValidation.error.message, HTTP_STATUS.BAD_REQUEST)
    }

    const { newCredits } = deltaValidation.data

    // Si delta es positivo, verificar créditos disponibles del builder
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

      // Descontar créditos del builder
      await creditsService.deductCreditsForTicket(builderId, delta, ticket.code)
    }

    // Si delta es negativo, devolver créditos al builder
    if (delta < 0) {
      // Reembolsar créditos al builder
      await creditsService.refundCreditsFromTicket(
        builderId,
        Math.abs(delta),
        ticket.code
      )
    }

    // Actualizar el ticket
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

    console.error('Error updating ticket:', error)
    return apiError(
      'Error interno del servidor',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}

/**
 * DELETE /api/builders/tickets/:id
 * Eliminar un ticket (solo si no ha sido usado)
 */
export const DELETE: APIRoute = async ({ request, params }) => {
  try {
    const builderId = await getAuthenticatedBuilderId(request)

    const ticketId = Number(params.id)
    if (!ticketId || isNaN(ticketId)) {
      return apiError('ID de ticket inválido', HTTP_STATUS.BAD_REQUEST)
    }

    // Verificar que el ticket existe y pertenece al builder
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

    // Calcular créditos a reembolsar:
    // - Si el ticket NO fue usado: reembolsar créditos originales
    // - Si el ticket FUE usado: reembolsar solo los créditos restantes (no los consumidos)
    const creditsToRefund = ticket.has_been_used
      ? ticket.credits // Solo los créditos restantes
      : ticket.original_credits // Todos los créditos originales

    // Reembolsar créditos al builder (si hay créditos que reembolsar)
    if (creditsToRefund > 0) {
      await creditsService.refundCreditsFromTicket(
        builderId,
        creditsToRefund,
        ticket.code
      )
    }

    // Eliminar el ticket
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

    console.error('Error deleting ticket:', error)
    return apiError(
      'Error interno del servidor',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
