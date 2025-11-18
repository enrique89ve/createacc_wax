/**
 * 👥 BUILDERS API: ACCOUNTS
 *
 * GET /api/builders/accounts - Listar cuentas creadas por el builder
 */

import type { APIRoute } from 'astro'
import { HTTP_STATUS } from '@/consts/constants'
import {
	getAuthenticatedBuilderId,
	handleAuthError,
} from '@/lib/auth/builder-auth'
import { usersRepository } from '@/lib/repositories/users-repository'
import { apiSuccess } from '@/utils/errorResponse'
import type { AccountsListResponse } from '@/types/api-contracts'

/**
 * GET /api/builders/accounts
 * Listar todas las cuentas creadas por el builder autenticado
 */
export const GET: APIRoute = async ({ request }) => {
	try {
		const builderId = await getAuthenticatedBuilderId(request)

		// Obtener cuentas creadas por el builder
		const accounts = await usersRepository.getAccountsByUser(builderId)

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
		return handleAuthError(error)
	}
}
