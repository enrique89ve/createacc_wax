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
import { assertCanPerform, unauthorizedResponse } from '@/lib/auth/permissions'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { creditsService } from '@/lib/credits-service'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { withTransaction } from '@/lib/database'
import { isUniqueConstraintViolation } from '@/lib/database-errors'
import { auditRepository } from '@/lib/repositories/audit-repository'
import {
  validateTicketName,
  validateTicketUses,
  validateTicketDescription,
} from '@/lib/validators/ticket-validator'
import { isValidationSuccess } from '@/utils/validation-result'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { requireValidOrigin } from '@/utils/csrf-protection'
import { parseJsonObject } from '@/utils/http-input'
import type { CreateTicketResponse } from '@/types/api-contracts'

/**
 * GET /api/builders/tickets
 * List all tickets of the authenticated builder
 */
export const GET: APIRoute = async context => {
  return withBuilderApiSession(context, async session => {
    try {
      assertCanPerform(session, 'VIEW_OWN_TICKETS', 'GET /api/builders/tickets')
    } catch {
      return unauthorizedResponse()
    }

    try {
      const tickets = await ticketsRepository.getBuilderTicketsWithCreator(
        session.username
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
export const POST: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withBuilderApiSession(context, async session => {
    try {
      assertCanPerform(session, 'CREATE_TICKET', 'POST /api/builders/tickets')
    } catch {
      return unauthorizedResponse()
    }

    try {
      const body = await parseJsonObject(context.request)
      if (!body) {
        return apiError('Solicitud JSON inválida', HTTP_STATUS.BAD_REQUEST)
      }
      const { code, uses, description } = body

      const codeValidation = validateTicketName(code)
      if (!isValidationSuccess(codeValidation)) {
        return apiError(codeValidation.error.message, HTTP_STATUS.BAD_REQUEST)
      }

      const usesValidation = validateTicketUses(uses)
      if (!isValidationSuccess(usesValidation)) {
        return apiError(usesValidation.error.message, HTTP_STATUS.BAD_REQUEST)
      }

      const descriptionValidation = validateTicketDescription(description)
      if (!isValidationSuccess(descriptionValidation)) {
        return apiError(
          descriptionValidation.error.message,
          HTTP_STATUS.BAD_REQUEST
        )
      }

      const ticketCode = codeValidation.data
      const ticketUses = usesValidation.data
      const ticketDescription = descriptionValidation.data

      const existingTicket = await ticketsRepository.findByCode(ticketCode)
      if (existingTicket) {
        return apiError(
          'Ya existe un ticket con ese código',
          HTTP_STATUS.CONFLICT
        )
      }

      const validation = await creditBalanceTracker.validateOperation(
        session.username,
        'deduct',
        ticketUses
      )

      if (!validation.valid) {
        return apiError(
          validation.reason || 'Operación inválida',
          HTTP_STATUS.BAD_REQUEST
        )
      }

      const createdTicket = await withTransaction(async () => {
        const ticket = await ticketsRepository.create({
          code: ticketCode,
          description: ticketDescription,
          total_uses: ticketUses,
          remaining_uses: ticketUses,
          creator_username: session.username,
          funding_source: 'builder_credits',
          owner_builder_username: session.username,
        })
        const operationReference = `ticket:${ticket.id}:create`
        await creditsService.deductCreditsForTicket(
          session.username,
          ticketUses,
          ticketCode,
          operationReference
        )
        await auditRepository.createTicketLog({
          ticketId: ticket.id,
          ticket: ticket.code,
          action: 'create',
          actorType: 'builder',
          actorId: session.username,
          afterUses: ticket.remaining_uses,
          afterState: {
            fundingSource: 'builder_credits',
            ownerBuilderUsername: session.username,
          },
          operationReference,
        })
        return ticket
      })

      const response: CreateTicketResponse = {
        success: true,
        ticketId: createdTicket.id,
        code: createdTicket.code,
        uses: createdTicket.remaining_uses,
      }

      return apiSuccess(response, HTTP_STATUS.CREATED)
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return apiError(
          'Ya existe un ticket con ese código',
          HTTP_STATUS.CONFLICT
        )
      }
      logger.error('Error creating ticket:', error)
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
