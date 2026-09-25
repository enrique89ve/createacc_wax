import { execute } from '@/lib/database'
import {
  findSimilarUsernames,
  isWithinTimeRange,
} from '@/utils/username-similarity'
import { isSuspiciousUsername } from '@/utils/suspicious-username'

const SIMILARITY_THRESHOLD = 0.68
const RECENT_ACCOUNT_WINDOW_HOURS = 24

export type UsernamePolicyResult =
  | { readonly status: 'allowed' }
  | { readonly status: 'suspicious' }
  | { readonly status: 'similar' }
  | { readonly status: 'unavailable' }

export async function checkUsernamePolicy(
  username: string
): Promise<UsernamePolicyResult> {
  if (isSuspiciousUsername(username)) return { status: 'suspicious' }

  try {
    const timeLimit = new Date(
      Date.now() - RECENT_ACCOUNT_WINDOW_HOURS * 60 * 60 * 1000
    )
    const timeLimitString = timeLimit
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')
    const result = await execute({
      sql: `
        SELECT username, creation_date
        FROM Accounts
        WHERE creation_date >= ?
        ORDER BY creation_date DESC
      `,
      args: [timeLimitString],
    })

    const normalizedUsername = username.toLowerCase().trim()
    const recentAccounts = result.rows.flatMap(row => {
      const usernameValue = row.username
      const creationDate = row.creation_date
      if (
        typeof usernameValue !== 'string' ||
        typeof creationDate !== 'string' ||
        usernameValue.toLowerCase() === normalizedUsername ||
        !isWithinTimeRange(creationDate, RECENT_ACCOUNT_WINDOW_HOURS)
      ) {
        return []
      }
      return [{ username: usernameValue, creation_date: creationDate }]
    })
    const similarity = findSimilarUsernames(
      normalizedUsername,
      recentAccounts,
      SIMILARITY_THRESHOLD
    )

    return similarity.isSimilar ? { status: 'similar' } : { status: 'allowed' }
  } catch {
    return { status: 'unavailable' }
  }
}
