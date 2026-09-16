import type { APIRoute } from 'astro'
import { buildLogoutHeaders } from '@/utils/logout-helpers'
import { clearBuilderSessionCookie } from '@/lib/auth/builder-session'

export const POST: APIRoute = async ({ request, cookies }) => {
  clearBuilderSessionCookie(cookies)
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: buildLogoutHeaders(request),
  })
}
