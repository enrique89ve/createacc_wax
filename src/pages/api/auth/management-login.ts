/**
 * Custom management login endpoint
 * Manually creates Auth.js session to avoid redirect loops
 *
 * Security features:
 * - Rate limiting to prevent brute-force attacks
 * - Auth.js compatible JWT tokens
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { validateCredentials } from '@/lib/admin/auth/validators/unified-validator'
import type { PasswordCredentials } from '@/lib/admin/auth/validators/unified-validator'
import { encode } from '@auth/core/jwt'
import { HTTP_STATUS } from '@/consts/constants'
import { UserRole } from '@/lib/roles'
import {
  checkLoginRateLimit,
  recordLoginAttempt,
} from '@/lib/rate-limiter-server'
import { shouldUseSecureCookie } from '@/utils/cookie-helpers'
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

export const POST: APIRoute = async (context) => {
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

    const passwordCredentials: PasswordCredentials = {
      type: 'password',
      username: normalizedUsername,
      password: normalizedPassword,
    }

    const validationResult = await validateCredentials(
      passwordCredentials,
      'password'
    )

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

    // Verificar que el usuario sea admin
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

    // Obtener secreto
    const secret = process.env.AUTH_SECRET
    if (!secret) {
      logger.error('AUTH_SECRET is missing')
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Error de configuración del servidor',
        }),
        { status: 500 }
      )
    }

    // Determinar nombre de cookie y opciones
    const isSecure = shouldUseSecureCookie(request)
    const cookieName = isSecure
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token'

    // Crear payload del token (debe coincidir con lo que espera jwtCallback)
    const token = {
      sub: user.id,
      userId: user.id,
      username: user.username,
      role: user.role,
      auth_method: user.auth_method,
      loginTime: user.loginTime,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 horas
      jti: crypto.randomUUID(),
    }

    // Firmar token
    const encodedToken = await encode({
      token,
      secret,
      salt: cookieName,
    })

    await persistLoginAttempt(
      request,
      source.sourceKey,
      normalizedUsername,
      true
    )

    // Crear header Set-Cookie
    const cookieOptions = [
      `${cookieName}=${encodedToken}`,
      `Path=/`,
      `HttpOnly`,
      `SameSite=Strict`,
      `Max-Age=${24 * 60 * 60}`,
    ]

    if (isSecure) {
      cookieOptions.push('Secure')
    }

    const cookieHeader = cookieOptions.join('; ')

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
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': cookieHeader,
        },
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
