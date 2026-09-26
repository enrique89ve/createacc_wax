/**
 * Challenge endpoint for Keychain authentication.
 * The server builds the exact message the client must sign.
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { HTTP_STATUS } from '@/consts/constants'
import { requireValidOrigin } from '@/utils/csrf-protection'
import {
  checkChallengeRateLimit,
  createBuilderChallenge,
} from '@/lib/auth/builder-auth'
import { z } from 'astro/zod'
import { apiError, apiSuccess } from '@/utils/errorResponse'

const BuilderChallengeRequestSchema = z.looseObject({
  username: z.unknown().optional(),
})

function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  try {
    if (!context.clientAddress) {
      return apiError(
        'Unable to determine client identity',
        HTTP_STATUS.FORBIDDEN
      )
    }

    if (!checkChallengeRateLimit(context.clientAddress)) {
      return apiError('Rate limit exceeded', HTTP_STATUS.TOO_MANY_REQUESTS)
    }

    let rawBody: unknown
    try {
      rawBody = await context.request.json()
    } catch {
      return apiError(
        'The request body must contain valid JSON.',
        HTTP_STATUS.BAD_REQUEST
      )
    }
    const parsedBody = BuilderChallengeRequestSchema.safeParse(rawBody)
    if (!parsedBody.success) {
      return apiError('Invalid challenge request.', HTTP_STATUS.BAD_REQUEST)
    }

    const username = asNonEmptyString(parsedBody.data.username)
    const result = await createBuilderChallenge(username)

    if (!result.ok) {
      return apiError(result.error, HTTP_STATUS.BAD_REQUEST)
    }

    return apiSuccess(
      {
        username: result.value.username,
        message: result.value.message,
        expiresAt: result.value.expiresAt,
      },
      HTTP_STATUS.OK
    )
  } catch (error) {
    logger.error('Error generating challenge:', error)
    return apiError(
      'Error generando challenge',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
