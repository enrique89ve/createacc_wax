import type { APIRoute } from 'astro'
import { execute } from '@/lib/database'
import {
  findSimilarUsernames,
  isWithinTimeRange,
  type SimilarityCheckResult,
} from '@/utils/username-similarity'
import {
  checkCreationRateLimit,
  createRateLimitResponse,
} from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'

interface SimilarityValidationRequest {
  readonly username: string
}

/**
 * F5a FIX: Reduced response - only returns isSimilar boolean.
 * Removed: similarUsernames (real account names), scores, dates,
 * totalAccountsChecked, configurable threshold/timeRange, GET endpoint.
 */

const DEFAULT_THRESHOLD = 0.68
const DEFAULT_TIME_RANGE_HOURS = 24

export const POST: APIRoute = async context => {
  try {
    const clientIp = resolveClientIp(context)
    const rateLimit = checkCreationRateLimit('similarity', clientIp)
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit.retryAfterMs)
    }

    const { request } = context
    const data: SimilarityValidationRequest = await request.json()
    const { username } = data

    if (!username || typeof username !== 'string') {
      return new Response(JSON.stringify({ error: 'Username es requerido' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      })
    }

    const now = new Date()
    const timeLimit = new Date(
      now.getTime() - DEFAULT_TIME_RANGE_HOURS * 60 * 60 * 1000
    )
    const timeLimitStr = timeLimit.toISOString().slice(0, 19).replace('T', ' ')

    const result = await execute({
      sql: `
				SELECT username, creation_date
				FROM Accounts
				WHERE creation_date >= ?
				ORDER BY creation_date DESC
			`,
      args: [timeLimitStr],
    })

    const existingAccounts = result.rows.map(row => ({
      username: row.username as string,
      creation_date: row.creation_date as string,
    }))

    const recentAccounts = existingAccounts.filter(account =>
      isWithinTimeRange(account.creation_date, DEFAULT_TIME_RANGE_HOURS)
    )

    const similarityResult: SimilarityCheckResult = findSimilarUsernames(
      username,
      recentAccounts,
      DEFAULT_THRESHOLD
    )

    return new Response(
      JSON.stringify({ isSimilar: similarityResult.isSimilar }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    )
  } catch (_error) {
    return new Response(
      JSON.stringify({
        error: 'Error interno del servidor',
        isSimilar: true,
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    )
  }
}
