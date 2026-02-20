import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { usersRepository } from '@/lib/repositories/users-repository'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { creditsService } from '@/lib/credits-service'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { UserRole } from '@/lib/roles'
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

// GET: List tickets
export const GET: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      let tickets

      if (session.role === UserRole.Admin) {
        // Admin can see all tickets
        tickets = await ticketsRepository.getAllWithCreators()
      } else {
        // Builder only sees their tickets
        tickets = await ticketsRepository.getUserTicketsWithCreator(
          session.userId
        )
      }

      return apiSuccess({ tickets })
    } catch (error) {
      return apiError(API_MESSAGES.ERRORS.INTERNAL_ERROR, 500)
    }
  })
}


// Helper: Get user data (using unified repository)
const getUserData = async (
  userId: number
): Promise<{ id: number; username: string } | null> => {
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
  userId: number
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

      const username = userData.username

      // Verify available credits for builders
      if (session.role === UserRole.Builder) {
        const userCredits = await creditBalanceTracker.getBalance(username)

        if (!userCredits || userCredits.available_amount < credits) {
          return apiError(
            `Créditos insuficientes. Necesitas ${credits} créditos, pero solo tienes ${userCredits?.available_amount || 0} disponibles.`,
            403,
            {
              required_credits: credits,
              available_credits: userCredits?.available_amount || 0,
            }
          )
        }
      }

      // Validation: Code already exists
      if (await ticketCodeExists(cleanCode)) {
        return apiError(API_MESSAGES.ERRORS.TICKET_CODE_EXISTS, 400)
      }

      // Consume credits (only for builders)
      if (session.role === UserRole.Builder) {
        try {
          await creditsService.deductCreditsForTicket(
            session.userId,
            credits,
            cleanCode
          )
        } catch (error) {
          return apiError(
            API_MESSAGES.ERRORS.CREDITS_DEDUCTION_ERROR,
            500,
            error instanceof Error ? error.message : 'Unknown error'
          )
        }
      }

      // Create ticket in database (using correct fields from new schema)
      const ticketResult = await db.execute({
        sql: `INSERT INTO Tickets (code, description, original_credits, credits, created_by)
					VALUES (?, ?, ?, ?, ?) RETURNING id`,
        args: [cleanCode, validDescription, credits, credits, session.userId],
      })

      const ticketId = ticketResult.rows[0]?.id as number

      // Audit log
      await createTicketAudit(cleanCode, session.userId)

      // Get final balance
      const finalUserCredits = await creditBalanceTracker.getBalance(username)

      return apiSuccess({
        message: API_MESSAGES.SUCCESS.TICKET_CREATED,
        ticket: {
          id: ticketId,
          code: cleanCode,
          description: validDescription,
          original_credits: credits,
        },
        credits_info: {
          credits_deducted: credits,
          new_credits: finalUserCredits?.available_amount || 0,
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
