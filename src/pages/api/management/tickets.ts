import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import {
  assertCanPerform,
  Permission,
  unauthorizedResponse,
} from '@/lib/auth/permissions'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { API_MESSAGES } from '@/consts/api-messages'
import { HTTP_STATUS } from '@/consts/constants'
import { requireValidOrigin } from '@/utils/csrf-protection'
import {
  validateTicketDescription,
  validateTicketName,
  validateTicketUses,
} from '@/lib/validators/ticket-validator'
import { isValidationSuccess } from '@/utils/validation-result'
import type { CreateTicketResponse } from '@/types/api-contracts'
import { logger } from '@/lib/logger'
import { auditRepository } from '@/lib/repositories/audit-repository'
import { withTransaction } from '@/lib/database'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// GET: List tickets (admin sees all)
export const GET: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.VIEW_ALL_TICKETS,
        'GET /api/management/tickets'
      )
    } catch {
      return unauthorizedResponse()
    }

    try {
      const tickets = await ticketsRepository.getAllWithCreators()
      return apiSuccess({ tickets })
    } catch (error) {
      return apiError(API_MESSAGES.ERRORS.INTERNAL_ERROR, 500)
    }
  })
}

/**
 * POST /api/management/tickets
 * Create a system ticket without consuming a Builder's credits.
 *
 * This endpoint intentionally uses the admin session helper rather than the
 * Builder session helper. The permission check is defense in depth so a
 * future role or route change cannot silently widen this operation.
 */
export const POST: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withAdminApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.CREATE_ADMIN_TICKET,
        'POST /api/management/tickets'
      )
    } catch {
      return unauthorizedResponse()
    }

    try {
      let payload: unknown
      try {
        payload = await context.request.json()
      } catch {
        return apiError(
          API_MESSAGES.ERRORS.INVALID_REQUEST,
          HTTP_STATUS.BAD_REQUEST
        )
      }

      const body = isRecord(payload) ? payload : null

      const codeValidation = validateTicketName(body?.code)
      if (!isValidationSuccess(codeValidation)) {
        return apiError(codeValidation.error.message, HTTP_STATUS.BAD_REQUEST)
      }

      const usesValidation = validateTicketUses(body?.uses)
      if (!isValidationSuccess(usesValidation)) {
        return apiError(usesValidation.error.message, HTTP_STATUS.BAD_REQUEST)
      }

      const descriptionValidation = validateTicketDescription(body?.description)
      if (!isValidationSuccess(descriptionValidation)) {
        return apiError(
          descriptionValidation.error.message,
          HTTP_STATUS.BAD_REQUEST
        )
      }

      const existingTicket = await ticketsRepository.findByCode(
        codeValidation.data
      )
      if (existingTicket) {
        return apiError(
          API_MESSAGES.ERRORS.TICKET_ALREADY_EXISTS,
          HTTP_STATUS.CONFLICT
        )
      }

      const createdTicket = await withTransaction(async () => {
        const ticket = await ticketsRepository.create({
          code: codeValidation.data,
          description: descriptionValidation.data,
          total_uses: usesValidation.data,
          remaining_uses: usesValidation.data,
          creator_username: session.username,
          funding_source: 'system',
          issuer_admin_id: session.userId,
        })

        await auditRepository.createTicketLog({
          ticket: ticket.code,
          action: 'create',
          performed_by: session.userId,
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
      if (error instanceof Error && /unique constraint/i.test(error.message)) {
        return apiError(
          API_MESSAGES.ERRORS.TICKET_ALREADY_EXISTS,
          HTTP_STATUS.CONFLICT
        )
      }

      logger.error('Error creating management ticket:', error)
      return apiError(
        API_MESSAGES.ERRORS.INTERNAL_ERROR,
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
