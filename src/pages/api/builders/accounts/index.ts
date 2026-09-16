/**
 * BUILDERS API: ACCOUNTS
 *
 * GET /api/builders/accounts - List accounts created by the builder
 */

import type { APIRoute } from 'astro'
import { HTTP_STATUS } from '@/consts/constants'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { assertCanPerform, unauthorizedResponse } from '@/lib/auth/permissions'
import { usersRepository } from '@/lib/repositories/users-repository'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import type { AccountsListResponse } from '@/types/api-contracts'

/**
 * GET /api/builders/accounts
 * List all accounts created by the authenticated builder
 */
export const GET: APIRoute = async context => {
  return withBuilderApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        'VIEW_OWN_ACCOUNTS',
        'GET /api/builders/accounts'
      )
    } catch {
      return unauthorizedResponse()
    }

    try {
      const accounts = await usersRepository.getAccountsByUser(session.username)

      const response: AccountsListResponse = {
        success: true,
        accounts: accounts.map(account => ({
          id: account.id,
          username: account.username,
          ticket: account.ticket,
          creation_date: account.creation_date,
          registered_at: account.registered_at,
          ticket_description: account.ticket_description,
          ticket_original_credits: account.ticket_original_credits,
          ticket_remaining_credits: account.ticket_remaining_credits,
        })),
        total: accounts.length,
      }

      return apiSuccess(response, HTTP_STATUS.OK)
    } catch (error) {
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
