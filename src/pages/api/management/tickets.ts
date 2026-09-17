import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { API_MESSAGES } from '@/consts/api-messages'

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
