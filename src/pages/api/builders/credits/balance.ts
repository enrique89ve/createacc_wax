/**
 * API: Consulta de Balance de Créditos
 *
 * Endpoint ÚNICO para consultar créditos de builders.
 * Usa credit-balance-tracker como fuente de verdad.
 *
 * GET /api/credits/balance?username=foo
 * GET /api/credits/balance?detailed=true
 */

import type { APIRoute } from 'astro'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { HTTP_STATUS } from '@/consts/constants'
import { API_MESSAGES } from '@/consts/api-messages'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { assertCanPerform, unauthorizedResponse } from '@/lib/admin/permissions-management'

export const GET: APIRoute = async (context) => {
	return withBuilderApiSession(context, async (session) => {
		try {
			assertCanPerform(session, 'VIEW_OWN_CREDITS', 'GET /api/builders/credits/balance')
		} catch {
			return unauthorizedResponse()
		}

		try {
			const detailed = context.url.searchParams.get('detailed') === 'true'
			const targetUsername = session.username

			if (!targetUsername) {
				return apiError(API_MESSAGES.ERRORS.USERNAME_NOT_SPECIFIED, HTTP_STATUS.BAD_REQUEST)
			}

			if (detailed) {
				const balance =
					await creditBalanceTracker.getDetailedBalance(targetUsername)

				if (!balance) {
					return apiError(API_MESSAGES.ERRORS.BUILDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
				}

				return apiSuccess({
					balance,
					warning: balance.discrepancy.has_discrepancy
						? 'Se detectaron inconsistencias en el balance'
						: null,
				})
			} else {
				const balance = await creditBalanceTracker.getBalance(targetUsername)

				if (!balance) {
					return apiError(API_MESSAGES.ERRORS.BUILDER_NOT_FOUND, HTTP_STATUS.NOT_FOUND)
				}

				return apiSuccess({
					balance,
					warning: !balance.is_consistent
						? 'Balance inconsistente, consultar /api/credits/diagnose'
						: null,
				})
			}
		} catch (error) {
			return apiError(API_MESSAGES.ERRORS.INTERNAL_ERROR, HTTP_STATUS.INTERNAL_SERVER_ERROR)
		}
	})
}
