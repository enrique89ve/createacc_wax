import type { APIRoute } from 'astro'
import { CREATION_SESSION_CONFIG } from '@/consts/constants'

export const POST: APIRoute = async () => {
  // Clear all session cookies
  const cookiesToClear = [
    'authjs.session-token',
    '__Secure-authjs.session-token',
    'authjs.csrf-token',
    '__Host-authjs.csrf-token',
    CREATION_SESSION_CONFIG.COOKIE_NAME, // 'hh_creation_session'
  ]

  const headers = new Headers()
  headers.append('Content-Type', 'application/json')

  cookiesToClear.forEach(name => {
    // SameSite=Strict para consistencia con el resto de la app
    headers.append(
      'Set-Cookie',
      `${name}=; Path=/; HttpOnly; Max-Age=0; SameSite=Strict`
    )
  })

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers,
  })
}
