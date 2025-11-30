/**
 * 🔍 API: Diagnóstico de Créditos
 *
 * Endpoint para detectar inconsistencias en el sistema de créditos.
 * SOLO ADMINS pueden acceder.
 *
 * GET /api/credits/diagnose
 * GET /api/credits/diagnose?username=foo  - Diagnóstico de un builder específico
 */

import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { jsonResponse } from '@/utils/api-response'
import { HTTP_STATUS, USER_ROLES } from '@/consts/constants'

export const GET: APIRoute = async ({ request, url }) => {
	try {
		const session = await getSession(request)

		// Solo admins
		if (!session?.user || session.user.role !== USER_ROLES.ADMIN) {
			return jsonResponse(
				{ success: false, error: 'Acceso denegado: solo admins' },
				HTTP_STATUS.FORBIDDEN
			)
		}

		const username = url.searchParams.get('username')

		if (username) {
			// Diagnóstico de un builder específico
			const balance =
				await creditBalanceTracker.getDetailedBalance(username)

			if (!balance) {
				return jsonResponse(
					{ success: false, error: 'Builder no encontrado' },
					HTTP_STATUS.NOT_FOUND
				)
			}

			const consistency = await creditBalanceTracker.checkConsistency(
				balance.builder_id
			)

			return jsonResponse(
				{
					success: true,
					builder: {
						id: balance.builder_id,
						username: balance.hive_username,
					},
					balance: {
						pending: balance.pending_amount,
						available: balance.available_amount,
						total_assigned: balance.total_assigned,
						total_consumed: balance.total_consumed,
					},
					breakdown: balance.breakdown,
					discrepancy: balance.discrepancy,
					consistency_check: consistency,
				},
				HTTP_STATUS.OK
			)
		} else {
			// Diagnóstico global del sistema
			const inconsistencies =
				await creditBalanceTracker.detectAllInconsistencies()

			const duplicates =
				await creditBalanceTracker.detectDuplicateAssignments(86400) // últimas 24h

			return jsonResponse(
				{
					success: true,
					system_status: {
						total_inconsistencies: inconsistencies.length,
						has_issues: inconsistencies.length > 0 || duplicates.length > 0,
					},
					inconsistencies: inconsistencies.map((check) => ({
						builder_id: check.builder_id,
						is_consistent: check.is_consistent,
						issues: check.issues,
						difference: check.difference,
					})),
					duplicate_assignments: duplicates,
					checked_at: new Date().toISOString(),
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
