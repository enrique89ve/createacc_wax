/**
 * API: Diagnóstico de Créditos
 *
 * Endpoint para detectar inconsistencias en el sistema de créditos.
 * SOLO ADMINS pueden acceder.
 *
 * GET /api/credits/diagnose
 * GET /api/credits/diagnose?username=foo  - Diagnóstico de un builder específico
 */

import type { APIRoute } from 'astro'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { apiSuccess, apiError } from '@/utils/errorResponse'
import { HTTP_STATUS } from '@/consts/constants'
import { withAdminApiSession } from '@/lib/session-helpers'
import {
  assertCanPerform,
  Permission,
  unauthorizedResponse,
} from '@/lib/auth/permissions'

export const GET: APIRoute = async context => {
  return withAdminApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.MANAGE_ALL_CREDITS,
        'GET /api/builders/credits/diagnose'
      )
    } catch {
      return unauthorizedResponse()
    }

    try {
      const username = context.url.searchParams.get('username')

      if (username) {
        const balance = await creditBalanceTracker.getDetailedBalance(username)

        if (!balance) {
          return apiError('Builder no encontrado', HTTP_STATUS.NOT_FOUND)
        }

        const consistency = await creditBalanceTracker.checkConsistency(
          balance.hive_username
        )

        return apiSuccess({
          builder: {
            id: balance.hive_username,
            username: balance.hive_username,
          },
          balance: {
            pending: balance.pending_amount,
            available: balance.available_amount,
            total_issued: balance.total_issued,
            total_consumed: balance.total_consumed,
          },
          breakdown: balance.breakdown,
          discrepancy: balance.discrepancy,
          consistency_check: consistency,
        })
      }

      // Global system diagnosis
      const inconsistencies =
        await creditBalanceTracker.detectAllInconsistencies()

      const duplicates: readonly { hive_username: string }[] = []

      return apiSuccess({
        system_status: {
          total_inconsistencies: inconsistencies.length,
          has_issues: inconsistencies.length > 0 || duplicates.length > 0,
        },
        inconsistencies: inconsistencies.map(check => ({
          hive_username: check.hive_username,
          is_consistent: check.is_consistent,
          critical_issues: check.critical_issues,
          warning_issues: check.warning_issues,
          difference: check.difference,
        })),
        duplicate_assignments: duplicates,
        checked_at: new Date().toISOString(),
      })
    } catch (error) {
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
