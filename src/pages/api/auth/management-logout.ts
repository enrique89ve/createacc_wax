import type { APIRoute } from 'astro'
import { buildLogoutHeaders } from '@/utils/logout-helpers'

export const POST: APIRoute = async ({ request }) => {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: buildLogoutHeaders(request),
  })
}
