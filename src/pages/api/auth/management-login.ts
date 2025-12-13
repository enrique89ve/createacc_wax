/**
 * Custom management login endpoint
 * Manually creates Auth.js session to avoid redirect loops
 *
 * Security features:
 * - Rate limiting to prevent brute-force attacks
 * - Auth.js compatible JWT tokens
 */

import type { APIRoute } from 'astro'
import { validateCredentials } from '@/lib/admin/auth/validators/unified-validator'
import type { PasswordCredentials } from '@/lib/admin/auth/validators/unified-validator'
import { encode } from '@auth/core/jwt'
import { HTTP_STATUS } from '@/consts/constants'
import { UserRole } from '@/lib/roles'
import {
  checkLoginRateLimit,
  resetRateLimit,
  RATE_LIMIT_CONFIG,
} from '@/lib/rate-limiter-server'

/**
 * Extract client IP from request headers
 */
function getClientIP(request: Request): string {
  // Check common proxy headers
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  const realIP = request.headers.get('x-real-ip')
  if (realIP) {
    return realIP.trim()
  }

  // Fallback to a generic identifier
  return 'unknown-ip'
}

export const POST: APIRoute = async ({ request }) => {
  try {
    // Rate limiting check
    const clientIP = getClientIP(request)
    const rateLimit = checkLoginRateLimit(clientIP)

    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Demasiados intentos. Intenta de nuevo en ${Math.ceil(rateLimit.retryAfter! / 60)} minutos`,
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

    const body = await request.json()
    const { username, password } = body

    if (!username || !password) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Credenciales requeridas',
          remaining: rateLimit.remaining,
        }),
        { status: HTTP_STATUS.BAD_REQUEST }
      )
    }

    const passwordCredentials: PasswordCredentials = {
      type: 'password',
      username: username.trim(),
      password,
    }

    const validationResult = await validateCredentials(
      passwordCredentials,
      'password'
    )

    if (!validationResult.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Credenciales inválidas',
          remaining: rateLimit.remaining,
        }),
        { status: HTTP_STATUS.UNAUTHORIZED }
      )
    }

    const user = validationResult.user

    // Reset rate limit on successful authentication
    resetRateLimit(clientIP)

    // Verificar que el usuario sea admin
    if (user.role !== UserRole.Admin) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Acceso restringido a administradores',
        }),
        { status: HTTP_STATUS.FORBIDDEN }
      )
    }

    // Obtener secreto
    const secret = import.meta.env.AUTH_SECRET || process.env.AUTH_SECRET
    if (!secret) {
      console.error('AUTH_SECRET is missing')
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Error de configuración del servidor',
        }),
        { status: 500 }
      )
    }

    // Determinar nombre de cookie y opciones
    const isSecure = request.url.startsWith('https')
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
    console.error('Management login error:', error)
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
