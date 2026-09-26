import type { APIRoute } from 'astro'
import { buildLogoutHeaders } from '@/utils/logout-helpers'
import { apiSuccess } from '@/utils/errorResponse'

export const POST: APIRoute = async ({ request }) => {
  return apiSuccess({}, 200, { headers: buildLogoutHeaders(request) })
}
