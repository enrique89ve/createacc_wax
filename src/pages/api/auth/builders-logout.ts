import type { APIRoute } from 'astro'
import { buildLogoutHeaders } from '@/utils/logout-helpers'
import { clearBuilderSessionCookie } from '@/lib/auth/builder-session'
import { apiSuccess } from '@/utils/errorResponse'

export const POST: APIRoute = async ({ request, cookies }) => {
  clearBuilderSessionCookie(cookies)
  return apiSuccess({}, 200, { headers: buildLogoutHeaders(request) })
}
