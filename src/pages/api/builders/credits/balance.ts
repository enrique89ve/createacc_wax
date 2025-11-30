/**
 * 💳 API: Consulta de Balance de Créditos
 *
 * Endpoint ÚNICO para consultar créditos de builders.
 * Usa credit-balance-tracker como fuente de verdad.
 *
 * GET /api/credits/balance?username=foo
 * GET /api/credits/balance?detailed=true
 */

import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { HTTP_STATUS, USER_ROLES } from '@/consts/constants'

const jsonResponse = (data: unknown, status: number): Response => {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

export const GET: APIRoute = async ({ request, url }) => {
	try {
		const session = await getSession(request)

		if (!session?.user) {
			return jsonResponse(
				{ success: false, error: 'No autorizado' },
				HTTP_STATUS.UNAUTHORIZED
			)
		}

		// Parámetros de query
		const username = url.searchParams.get('username')
		const detailed = url.searchParams.get('detailed') === 'true'

		// Determinar qué usuario consultar
		const targetUsername =
			session.user.role === USER_ROLES.ADMIN && username ? username : session.user.username

		if (!targetUsername) {
			return jsonResponse(
				{ success: false, error: 'Username no especificado' },
				HTTP_STATUS.BAD_REQUEST
			)
		}

		// Obtener balance
		if (detailed) {
			const balance =
				await creditBalanceTracker.getDetailedBalance(targetUsername)

			if (!balance) {
				return jsonResponse(
					{ success: false, error: 'Builder no encontrado' },
					HTTP_STATUS.NOT_FOUND
				)
			}

			return jsonResponse(
				{
					success: true,
					balance,
					warning: balance.discrepancy.has_discrepancy
						? 'Se detectaron inconsistencias en el balance'
						: null,
				},
				HTTP_STATUS.OK
			)
		} else {
			const balance = await creditBalanceTracker.getBalance(targetUsername)

			if (!balance) {
				return jsonResponse(
					{ success: false, error: 'Builder no encontrado' },
					HTTP_STATUS.NOT_FOUND
				)
			}

			return jsonResponse(
				{
					success: true,
					balance,
					warning: !balance.is_consistent
						? 'Balance inconsistente, consultar /api/credits/diagnose'
						: null,
				},
				HTTP_STATUS.OK
			)
		}
	} catch (error) {
		return jsonResponse(
			{
				success: false,
				error: 'Error interno del servidor',
			},
			HTTP_STATUS.INTERNAL_SERVER_ERROR
		)
	}
}
