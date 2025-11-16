import type { APIRoute } from 'astro'
import {
  isSuspiciousUsername,
  isSuspiciousUsernameFlexible,
  getSuspiciousReason,
  getSuspiciousStats,
} from '@/utils/suspicious-username'

interface SuspiciousValidationRequest {
  username: string
  strictMode?: boolean
  includeReason?: boolean
}

interface SuspiciousValidationResponse {
  isSuspicious: boolean
  reason?: string
  stats?: {
    totalSuspiciousAccounts: number
    totalPatterns: number
    cacheInitialized: boolean
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const data: SuspiciousValidationRequest = await request.json()
    const { username, strictMode = true, includeReason = false } = data

    // Validar entrada
    if (!username || typeof username !== 'string') {
      return new Response(
        JSON.stringify({
          error: 'Username es requerido y debe ser una cadena',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Validar username con el sistema de detección
    const isSuspicious = strictMode
      ? isSuspiciousUsername(username)
      : isSuspiciousUsernameFlexible(username, false)

    const response: SuspiciousValidationResponse = {
      isSuspicious,
    }

    // Agregar razón si es solicitada y el username es sospechoso
    if (includeReason && isSuspicious) {
      response.reason = getSuspiciousReason(username) || 'Username no permitido'
    }

    // Agregar estadísticas en modo debug
    if (includeReason) {
      response.stats = getSuspiciousStats()
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Error interno del servidor',
        isSuspicious: true, // Por seguridad, consideramos sospechoso en caso de error
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

// GET endpoint para estadísticas y testing
export const GET: APIRoute = async ({ url }) => {
  try {
    const searchParams = url.searchParams
    const testUsername = searchParams.get('test')

    if (testUsername) {
      // Modo testing - probar un username específico
      const isSuspicious = isSuspiciousUsername(testUsername)
      const reason = getSuspiciousReason(testUsername)

      return new Response(
        JSON.stringify({
          username: testUsername,
          isSuspicious,
          reason,
          stats: getSuspiciousStats(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Devolver estadísticas generales
    return new Response(
      JSON.stringify({
        message: 'HolaHive Suspicious Username Detection API',
        version: '1.0.0',
        stats: getSuspiciousStats(),
        usage: {
          POST: 'Validate username: {"username": "test123"}',
          GET: 'Get stats or test: ?test=username',
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: 'Error interno del servidor',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
