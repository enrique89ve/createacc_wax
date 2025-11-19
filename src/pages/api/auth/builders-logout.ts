import type { APIRoute } from 'astro'

export const POST: APIRoute = async ({ request }) => {
  // Clear both potential cookie names to be safe
  const cookiesToClear = [
    'authjs.session-token',
    '__Secure-authjs.session-token',
    'authjs.csrf-token',
    '__Host-authjs.csrf-token',
    'holahive_creation_session',
  ]

  const headers = new Headers()
  headers.append('Content-Type', 'application/json')

  cookiesToClear.forEach(name => {
    headers.append(
      'Set-Cookie',
      `${name}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`
    )
  })

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers,
  })
}
