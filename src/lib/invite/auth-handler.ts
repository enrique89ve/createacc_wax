import { z } from 'astro/zod'
import { createInviteAuth, INVITE_AUTH_PATH } from './auth'
import { getInviteConfiguration, type InviteConfiguration } from './config'

const SignInSchema = z.strictObject({ provider: z.enum(['github', 'twitter']) })
const CALLBACK_PATH_PATTERN = /^\/callback\/(github|twitter)$/

function error(status: number): Response {
  return Response.json(
    { success: false },
    { status, headers: { 'Cache-Control': 'no-store' } }
  )
}

export async function handleInviteAuthRequest(
  request: Request,
  configuration: InviteConfiguration | null = getInviteConfiguration()
): Promise<Response> {
  if (!configuration) return error(503)
  const path = new URL(request.url).pathname.slice(INVITE_AUTH_PATH.length)
  const auth = createInviteAuth(configuration)
  if (path === '/sign-in/social' && request.method === 'POST') {
    if (request.headers.get('origin') !== configuration.origin) {
      return error(403)
    }
    const input: unknown = await request.json().catch(() => null)
    const parsed = SignInSchema.safeParse(input)
    if (!parsed.success) return error(400)
    if (!configuration.providers[parsed.data.provider]) return error(503)
    const headers = new Headers(request.headers)
    headers.delete('content-length')
    return auth.handler(
      new Request(request.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          provider: parsed.data.provider,
          callbackURL: `${configuration.origin}/invite`,
          errorCallbackURL: `${configuration.origin}/invite?error=oauth`,
        }),
      })
    )
  }
  if (CALLBACK_PATH_PATTERN.test(path) && request.method === 'GET') {
    return auth.handler(request)
  }
  if (path === '/sign-out' && request.method === 'POST') {
    if (request.headers.get('origin') !== configuration.origin) {
      return error(403)
    }
    return auth.handler(request)
  }
  return error(404)
}
