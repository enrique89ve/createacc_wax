import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { HTTP_STATUS } from '@/consts/constants'
// Logger removed
import { creditsService } from '@/lib/credits-service'

/**
 * ⚠️ LEGACY API ENDPOINT - Backward Compatibility Layer
 *
 * Este endpoint mantiene los nombres de campos legacy para compatibilidad con clientes existentes:
 * - `user_credits` → mapea a `active_credits`
 * - `user_credits_total` → mapea a `total_credits`
 * - `credit_limit` → siempre retorna 0 (concepto eliminado en nuevo sistema)
 *
 * @deprecated Considerar migrar clientes a endpoint nuevo con nomenclatura actualizada
 */

export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request)

    if (!session?.user?.username) {
      return new Response(
        JSON.stringify({ success: false, error: 'No autorizado' }),
        {
          status: HTTP_STATUS.UNAUTHORIZED,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Get user credits info using new credits service
    const userCredits = await creditsService.getUserCredits(
      session.user.username
    )
    if (!userCredits) {
      // Usuario temporal (no está en BD) - retornar 0 créditos
      return new Response(
        JSON.stringify({
          success: true,
          user_credits: 0, // LEGACY: active_credits
          user_credits_total: 0, // LEGACY: total_credits
          credit_limit: 0, // LEGACY: concepto eliminado
          consumed_credits: 0,
          is_temporary_user: true,
        }),
        {
          status: HTTP_STATUS.OK,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Retornar con nombres legacy para compatibilidad
    return new Response(
      JSON.stringify({
        success: true,
        user_credits: userCredits.active_credits, // LEGACY: active_credits
        user_credits_total: userCredits.total_credits, // LEGACY: total_credits
        credit_limit: userCredits.credit_limit, // LEGACY: siempre 0
        consumed_credits: userCredits.consumed_credits,
      }),
      {
        status: HTTP_STATUS.OK,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: 'Error interno del servidor' }),
      {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
