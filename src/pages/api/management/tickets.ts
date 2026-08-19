import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { usersRepository } from '@/lib/repositories/users-repository'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { API_MESSAGES } from '@/consts/api-messages'
import { db } from '@/lib/database'
import {
	validateTicketName,
	validateTicketCredits,
	validateTicketDescription,
} from '@/lib/validators/ticket-validator'
import { isValidationSuccess } from '@/utils/validation-result'
// Types
interface TicketCreateRequest {
  readonly code?: string
  readonly description?: string
  readonly credits?: number
}

// GET: List tickets (admin sees all)
export const GET: APIRoute = async context => {
  return withAdminSession(context, async () => {
    try {
      const tickets = await ticketsRepository.getAllWithCreators()
      return apiSuccess({ tickets })
    } catch (error) {
      return apiError(API_MESSAGES.ERRORS.INTERNAL_ERROR, 500)
    }
  })
}


// Helper: Get user data (using unified repository)
const getUserData = async (
  userId: string
): Promise<{ id: string; username: string } | null> => {
  const user = await usersRepository.findById(userId)
  return user && user.is_active
    ? { id: user.id, username: user.username }
    : null
}

// Helper: Verify if the ticket code already exists (using repository)
const ticketCodeExists = async (code: string): Promise<boolean> => {
  const ticket = await ticketsRepository.findByCode(code)
  return ticket !== null
}

// Helper: Create ticket audit log
const createTicketAudit = async (
  ticketCode: string,
  userId: string
): Promise<void> => {
  await db.execute({
    sql: `INSERT INTO TicketAudit (ticket, action, performed_by)
			VALUES (?, 'create', ?)`,
    args: [ticketCode, userId],
  })
}

// POST: Create ticket
export const POST: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      const data = (await context.request.json()) as TicketCreateRequest

      const { code = '', description, credits: creditsInput } = data

      // Validate ticket code
      const codeValidation = validateTicketName(code)
      if (!isValidationSuccess(codeValidation)) {
        return apiError(codeValidation.error.message, 400)
      }

      // Validate credits
      const creditsValidation = validateTicketCredits(creditsInput)
      if (!isValidationSuccess(creditsValidation)) {
        return apiError(creditsValidation.error.message, 400)
      }

      // Validate description
      const descriptionValidation = validateTicketDescription(description)
      if (!isValidationSuccess(descriptionValidation)) {
        return apiError(descriptionValidation.error.message, 400)
      }

      const cleanCode = codeValidation.data
      const credits = creditsValidation.data
      const validDescription = descriptionValidation.data ?? ''

      // Get user data
      const userData = await getUserData(session.userId)
      if (!userData) {
        return apiError(API_MESSAGES.ERRORS.USER_NOT_FOUND, 404)
      }

      // Validation: Code already exists
      if (await ticketCodeExists(cleanCode)) {
        return apiError(API_MESSAGES.ERRORS.TICKET_CODE_EXISTS, 400)
      }

      // Create ticket in database
      const ticketResult = await db.execute({
        sql: `INSERT INTO Tickets (code, description, original_credits, credits, created_by)
					VALUES (?, ?, ?, ?, ?) RETURNING id`,
        args: [cleanCode, validDescription, credits, credits, session.userId],
      })

      const ticketId = ticketResult.rows[0]?.id as number

      // Audit log
      await createTicketAudit(cleanCode, session.userId)

      return apiSuccess({
        message: API_MESSAGES.SUCCESS.TICKET_CREATED,
        ticket: {
          id: ticketId,
          code: cleanCode,
          description: validDescription,
          original_credits: credits,
        },
      }, 201)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        return apiError(API_MESSAGES.ERRORS.TICKET_CODE_EXISTS, 400)
      }

      return apiError(API_MESSAGES.ERRORS.INTERNAL_ERROR, 500)
    }
  })
}
