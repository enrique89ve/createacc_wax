import type { APIRoute } from 'astro'
import { HTTP_STATUS } from '@/consts/constants'
import { verifyBuilderLogin } from '@/lib/auth/builder-auth'
import { setBuilderSessionCookie } from '@/lib/auth/builder-session'
import { logger } from '@/lib/logger'
import { UserRole } from '@/lib/roles'
import { requireValidOrigin } from '@/utils/csrf-protection'
import { z } from 'astro/zod'
import { apiError, apiSuccess } from '@/utils/errorResponse'

const KeychainVerifyBodySchema = z.looseObject({
  username: z.unknown().optional(),
  publicKey: z.unknown().optional(),
  signature: z.unknown().optional(),
  message: z.unknown().optional(),
})

function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  try {
    let rawBody: unknown
    try {
      rawBody = await context.request.json()
    } catch {
      return apiError(
        'Invalid authentication request.',
        HTTP_STATUS.BAD_REQUEST
      )
    }
    const parsedBody = KeychainVerifyBodySchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return apiError(
        'Invalid authentication request.',
        HTTP_STATUS.BAD_REQUEST
      )
    }
    const body = parsedBody.data
    const username = asNonEmptyString(body.username)
    const publicKey = asNonEmptyString(body.publicKey)
    const signature = asNonEmptyString(body.signature)
    const message = asNonEmptyString(body.message)

    const result = await verifyBuilderLogin({
      username,
      publicKey,
      signature,
      message: message || undefined,
    })

    if (!result.ok) {
      return apiError(result.error, HTTP_STATUS.UNAUTHORIZED)
    }

    setBuilderSessionCookie(context.cookies, result.value, context.request)

    return apiSuccess(
      {
        user: {
          username: result.value.username,
          role: UserRole.Builder,
        },
      },
      HTTP_STATUS.OK
    )
  } catch (error) {
    logger.error('Builder Keychain verify failed:', error)
    return apiError('Authentication failed', HTTP_STATUS.INTERNAL_SERVER_ERROR)
  }
}
