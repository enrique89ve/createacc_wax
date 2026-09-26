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
import { z } from 'astro/zod'
import { apiSuccess, createJsonResponse } from '@/utils/errorResponse'

const ManagementLoginBodySchema = z.looseObject({
  username: z.unknown().optional(),
  password: z.unknown().optional(),
})

const FALLBACK_USERNAME = 'anonymous'

function normalizeUsername(rawUsername: unknown): string {
  if (typeof rawUsername !== 'string') return ''
  return rawUsername.trim().toLowerCase()
}

function normalizePassword(rawPassword: unknown): string {
  if (typeof rawPassword !== 'string') return ''
  return rawPassword
}

function loginErrorResponse(
  error: string,
  status: number,
  extensions: Readonly<Record<string, unknown>> = {},
  headers?: HeadersInit
): Response {
  return createJsonResponse({ success: false, error, ...extensions }, status, {
    headers,
  })
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

    let rawBody: unknown
    try {
      rawBody = await request.json()
    } catch {
      await persistLoginAttempt(
        request,
        source.sourceKey,
        FALLBACK_USERNAME,
        false,
        'Invalid JSON body'
      )
      return loginErrorResponse('Payload inválido', HTTP_STATUS.BAD_REQUEST)
    }
    const parsedBody = ManagementLoginBodySchema.safeParse(rawBody)
    if (!parsedBody.success) {
      await persistLoginAttempt(
        request,
        source.sourceKey,
        FALLBACK_USERNAME,
        false,
        'Invalid request body'
      )
      return loginErrorResponse('Payload inválido', HTTP_STATUS.BAD_REQUEST)
    }
    const body = parsedBody.data

    const normalizedUsername = normalizeUsername(body.username)
    const normalizedPassword = normalizePassword(body.password)

    // Rate limiting check (source + username)
    const rateLimit = await checkLoginRateLimit({
      username: normalizedUsername || FALLBACK_USERNAME,
      sourceKey: source.sourceKey,
    })

    if (!rateLimit.allowed) {
      return loginErrorResponse(
        `Demasiados intentos. Intenta de nuevo en ${Math.ceil(rateLimit.retryAfter / 60)} minutos`,
        HTTP_STATUS.TOO_MANY_REQUESTS,
        { retryAfter: rateLimit.retryAfter },
        { 'Retry-After': String(rateLimit.retryAfter) }
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
      return loginErrorResponse(
        'Credenciales requeridas',
        HTTP_STATUS.BAD_REQUEST,
        { remaining: Math.max(0, rateLimit.remaining - 1) }
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
      return loginErrorResponse(
        'Credenciales inválidas',
        HTTP_STATUS.UNAUTHORIZED,
        { remaining: Math.max(0, rateLimit.remaining - 1) }
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
      return loginErrorResponse(
        'Credenciales inválidas',
        HTTP_STATUS.UNAUTHORIZED,
        { remaining: Math.max(0, rateLimit.remaining - 1) }
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
      return loginErrorResponse(
        'Acceso restringido a administradores',
        HTTP_STATUS.FORBIDDEN
      )
    }

    const created = await createAdminAuthSession({
      username: user.username ?? normalizedUsername,
    })

    if (!created) {
      logger.error('Failed to create Better Auth session')
      return loginErrorResponse(
        'Error de configuración del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
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
    await appendAdminSessionCookie(headers, created.token)

    return apiSuccess(
      {
        user: {
          username: user.username,
          role: user.role,
        },
      },
      HTTP_STATUS.OK,
      { headers }
    )
  } catch (error) {
    logger.error('Management login error:', error)
    return loginErrorResponse(
      'Error del servidor',
      HTTP_STATUS.INTERNAL_SERVER_ERROR
    )
  }
}
