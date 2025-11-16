/**
 * @deprecated LEGACY ENDPOINT - DO NOT USE
 *
 * This endpoint is deprecated because the credit_limit concept no longer exists
 * in the new Admins/Builders architecture.
 *
 * For credits management use instead:
 * - POST /api/management/credits/assign - Admin assigns credits to Builder
 * - POST /api/credits/claim - Builder claims pending credits
 * - GET /api/credits/balance - Get current builder credits balance
 */
import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
// Logger removed

const DEPRECATION_MESSAGE =
  'Este endpoint está deprecado. El sistema ya no usa credit_limit. Use los endpoints de Credits para gestionar créditos de Builders.'

// PUT: DEPRECATED
export const PUT: APIRoute = async context => {
  return withAdminSession(context, async () => {
    return new Response(JSON.stringify({ error: DEPRECATION_MESSAGE }), {
      status: 410, // 410 Gone - indicates resource is permanently unavailable
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

// GET: DEPRECATED
export const GET: APIRoute = async context => {
  return withAdminSession(context, async () => {
    return new Response(JSON.stringify({ error: DEPRECATION_MESSAGE }), {
      status: 410, // 410 Gone - indicates resource is permanently unavailable
      headers: { 'Content-Type': 'application/json' },
    })
  })
}
