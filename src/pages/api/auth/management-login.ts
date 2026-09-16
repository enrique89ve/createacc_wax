/**
 * Custom management login endpoint
 * Validates admin password then creates a Better Auth session.
 *
 * Security features:
 * - Rate limiting to prevent brute-force attacks
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { HTTP_STATUS } from '@/consts/constants'
import { verifyPasswordAuth } from '@/lib/admin/auth/password'
import {
  appendAdminSessionCookie,
  createAdminAuthSession,
} from '@/lib/auth/admin-auth'
import { UserRole } from '@/lib/roles'
import {
  checkLoginRateLimit,
  recordLoginAttempt,
} from '@/lib/rate-limiter-server'
import { resolveRateLimitSource } from '@/lib/client-ip'

interface ManagementLoginBody {
  readonly username?: unknown
  readonly password?: unknown
}

const FALLBACK_USERNAME = 'anonymous'

function normalizeUsername(rawUsername: unknown): string {
  if (typeof rawUsername !== 'string') return ''
  return rawUsername.trim().toLowerCase()
}

function normalizePassword(rawPassword: unknown): string {
  if (typeof rawPassword !== 'string') return ''
  return rawPassword
}

async function persistLoginAttempt(
  request: Request,
  sourceKey: string,
  username: string,
  success: boolean,
  errorMessage?: string
): Promise<void> {
  try {
    await recordLoginAttempt({
      username: username || FALLBACK_USERNAME,
      sourceKey,
      userAgent: request.headers.get('user-agent'),
      success,
      errorMessage,
    })
  } catch (error) {
    logger.error('Failed to persist login attempt:', error)
  }
}

export const POST: APIRoute = async context => {
  const { request } = context
  try {
    const source = resolveRateLimitSource(context)

    let body: ManagementLoginBody
    try {
      body = (await request.json()) as ManagementLoginBody
    } catch {
      await persistLoginAttempt(
        request,
        source.sourceKey,
        FALLBACK_USERNAME,
        false,
        'Invalid JSON body'
      )
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Payload inválido',
        }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const normalizedUsername = normalizeUsername(body.username)
    const normalizedPassword = normalizePassword(body.password)

    // Rate limiting check (source + username)
    const rateLimit = await checkLoginRateLimit({
      username: normalizedUsername || FALLBACK_USERNAME,
      sourceKey: source.sourceKey,
    })

    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Demasiados intentos. Intenta de nuevo en ${Math.ceil(rateLimit.retryAfter / 60)} minutos`,
          retryAfter: rateLimit.retryAfter,
        }),
        {
          status: HTTP_STATUS.TOO_MANY_REQUESTS,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(rateLimit.retryAfter),
          },
        }
      )
    }

    if (!normalizedUsername || !normalizedPassword) {
      await persistLoginAttempt(
        request,
        source.sourceKey,
        normalizedUsername || FALLBACK_USERNAME,
        false,
        'Missing credentials'
      )
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Credenciales requeridas',
          remaining: Math.max(0, rateLimit.remaining - 1),
        }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const validationResult = await verifyPasswordAuth({
      username: normalizedUsername,
      password: normalizedPassword,
    })

    if (!validationResult.success) {
      await persistLoginAttempt(
        request,
        source.sourceKey,
        normalizedUsername,
        false,
        'Invalid credentials'
      )
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Credenciales inválidas',
          remaining: Math.max(0, rateLimit.remaining - 1),
        }),
        {
          status: HTTP_STATUS.UNAUTHORIZED,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const user = validationResult.user
    if (!user) {
      await persistLoginAttempt(
        request,
        source.sourceKey,
        normalizedUsername,
        false,
        'Invalid credentials'
      )
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Credenciales inválidas',
          remaining: Math.max(0, rateLimit.remaining - 1),
        }),
        {
          status: HTTP_STATUS.UNAUTHORIZED,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    if (user.role !== UserRole.Admin) {
      await persistLoginAttempt(
        request,
        source.sourceKey,
        normalizedUsername,
        false,
        'Role is not admin'
      )
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Acceso restringido a administradores',
        }),
        {
          status: HTTP_STATUS.FORBIDDEN,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }

    const created = await createAdminAuthSession({
      username: user.username ?? normalizedUsername,
    })

    if (!created) {
      logger.error('Failed to create Better Auth session')
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Error de configuración del servidor',
        }),
        { status: 500 }
      )
    }

    await persistLoginAttempt(
      request,
      source.sourceKey,
      normalizedUsername,
      true
    )

    const headers = new Headers({
      'Content-Type': 'application/json',
    })
    appendAdminSessionCookie(headers, created.token)

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          username: user.username,
          role: user.role,
        },
      }),
      {
        status: 200,
        headers,
      }
    )
  } catch (error) {
    logger.error('Management login error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Error del servidor',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )
  }
}
