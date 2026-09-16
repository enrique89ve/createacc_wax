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

function asNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export const POST: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  try {
    if (!context.clientAddress) {
      return new Response(
        JSON.stringify({ error: 'Unable to determine client identity' }),
        {
          status: HTTP_STATUS.FORBIDDEN,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          },
        }
      )
    }

    if (!checkChallengeRateLimit(context.clientAddress)) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: HTTP_STATUS.TOO_MANY_REQUESTS,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      })
    }

    const body = (await context.request.json()) as { username?: unknown }
    const username = asNonEmptyString(body.username)
    const result = await createBuilderChallenge(username)

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: HTTP_STATUS.BAD_REQUEST,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      })
    }

    return new Response(
      JSON.stringify({
        username: result.value.username,
        message: result.value.message,
        expiresAt: result.value.expiresAt,
      }),
      {
        status: HTTP_STATUS.OK,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    )
  } catch (error) {
    logger.error('Error generating challenge:', error)
    return new Response(
      JSON.stringify({ error: 'Error generando challenge' }),
      {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    )
  }
}
