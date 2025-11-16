import type { APIRoute } from 'astro'
import { db } from '@/lib/database'
import {
  findSimilarUsernames,
  isWithinTimeRange,
  generateSimilarityErrorMessage,
  type SimilarityCheckResult,
} from '@/utils/username-similarity'

interface SimilarityValidationRequest {
  readonly username: string
  readonly threshold?: number
  readonly timeRangeHours?: number
}

interface SimilarityValidationResponse {
  isSimilar: boolean
  similarUsernames?: Array<{
    username: string
    similarity: number
    createdAt: string
  }>
  threshold: number
  timeRangeHours: number
  errorMessage?: string
  totalAccountsChecked: number
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const data: SimilarityValidationRequest = await request.json()
    const { username, threshold = 0.68, timeRangeHours = 24 } = data

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

    if (threshold < 0 || threshold > 1) {
      return new Response(
        JSON.stringify({
          error: 'Threshold debe estar entre 0.0 y 1.0',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const now = new Date()
    const timeLimit = new Date(now.getTime() - timeRangeHours * 60 * 60 * 1000)
    const timeLimitStr = timeLimit.toISOString().slice(0, 19).replace('T', ' ')

    const result = await db.execute({
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
      isWithinTimeRange(account.creation_date, timeRangeHours)
    )

    const similarityResult: SimilarityCheckResult = findSimilarUsernames(
      username,
      recentAccounts,
      threshold
    )

    const response: SimilarityValidationResponse = {
      isSimilar: similarityResult.isSimilar,
      threshold: similarityResult.threshold,
      timeRangeHours,
      totalAccountsChecked: recentAccounts.length,
    }

    if (similarityResult.isSimilar) {
      response.similarUsernames = similarityResult.similarUsernames
      response.errorMessage = generateSimilarityErrorMessage(
        similarityResult.similarUsernames
      )
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (_error) {
    return new Response(
      JSON.stringify({
        error: 'Error interno del servidor',
        isSimilar: true,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const searchParams = url.searchParams
    const testUsername = searchParams.get('test')
    const threshold = parseFloat(searchParams.get('threshold') || '0.68')
    const timeRangeHours = parseInt(searchParams.get('hours') || '24')

    if (testUsername) {
      const now = new Date()
      const timeLimit = new Date(
        now.getTime() - timeRangeHours * 60 * 60 * 1000
      )
      const timeLimitStr = timeLimit
        .toISOString()
        .slice(0, 19)
        .replace('T', ' ')

      const result = await db.execute({
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
        isWithinTimeRange(account.creation_date, timeRangeHours)
      )

      const similarityResult = findSimilarUsernames(
        testUsername,
        recentAccounts,
        threshold
      )

      return new Response(
        JSON.stringify({
          username: testUsername,
          threshold,
          timeRangeHours,
          isSimilar: similarityResult.isSimilar,
          similarUsernames: similarityResult.similarUsernames,
          totalAccountsChecked: recentAccounts.length,
          errorMessage: similarityResult.isSimilar
            ? generateSimilarityErrorMessage(similarityResult.similarUsernames)
            : null,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const totalAccountsResult = await db.execute(
      'SELECT COUNT(*) as total FROM Accounts'
    )
    const recentAccountsResult = await db.execute({
      sql: 'SELECT COUNT(*) as recent FROM Accounts WHERE creation_date >= datetime("now", "-24 hours")',
      args: [],
    })

    return new Response(
      JSON.stringify({
        message: 'HolaHive Username Similarity Validation API',
        version: '1.0.0',
        defaultThreshold: 0.68,
        defaultTimeRangeHours: 24,
        stats: {
          totalAccounts: totalAccountsResult.rows[0].total,
          recentAccounts24h: recentAccountsResult.rows[0].recent,
        },
        usage: {
          POST: 'Validate similarity: {"username": "test123", "threshold": 0.68, "timeRangeHours": 24}',
          GET: 'Get stats or test: ?test=username&threshold=0.68&hours=24',
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (_error) {
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
