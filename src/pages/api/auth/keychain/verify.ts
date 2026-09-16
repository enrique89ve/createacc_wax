import type { APIRoute } from 'astro'
import { HTTP_STATUS } from '@/consts/constants'
import { verifyBuilderLogin } from '@/lib/auth/builder-auth'
import { setBuilderSessionCookie } from '@/lib/auth/builder-session'
import { logger } from '@/lib/logger'
import { UserRole } from '@/lib/roles'

interface KeychainVerifyBody {
  readonly username?: unknown
  readonly message?: unknown
  readonly publicKey?: unknown
  readonly signature?: unknown
}

function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST: APIRoute = async context => {
  try {
    const body = (await context.request.json()) as KeychainVerifyBody
    const username = asNonEmptyString(body.username)
    const message = asNonEmptyString(body.message)
    const publicKey = asNonEmptyString(body.publicKey)
    const signature = asNonEmptyString(body.signature)

    const result = await verifyBuilderLogin({
      username,
      message,
      publicKey,
      signature,
    })

    if (!result.ok) {
      return new Response(JSON.stringify({ message: result.error }), {
        status: HTTP_STATUS.UNAUTHORIZED,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    setBuilderSessionCookie(context.cookies, result.value, context.request)

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          username: result.value.username,
          role: UserRole.Builder,
        },
      }),
      {
        status: HTTP_STATUS.OK,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    logger.error('Builder Keychain verify failed:', error)
    return new Response(JSON.stringify({ message: 'Authentication failed' }), {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
