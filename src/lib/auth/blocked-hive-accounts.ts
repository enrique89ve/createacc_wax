import { db } from '@/lib/database'

const BLOCKED_MESSAGE = 'This Hive account is blocked'

export function blockedHiveAccountMessage(): string {
  return BLOCKED_MESSAGE
}

export function normalizeBlockedUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

export async function isHiveUsernameBlocked(
  username: string
): Promise<boolean> {
  const hiveUsername = normalizeBlockedUsername(username)
  if (hiveUsername.length < 3) return false

  const result = await db.execute({
    sql: 'SELECT 1 FROM BlockedHiveAccounts WHERE hive_username = ? LIMIT 1',
    args: [hiveUsername],
  })
  return result.rows.length > 0
}

export async function blockHiveUsername(params: {
  hiveUsername: string
  blockedBy: string
  reason?: string
}): Promise<string> {
  const hiveUsername = normalizeBlockedUsername(params.hiveUsername)
  if (hiveUsername.length < 3) {
    throw new Error('Hive username must be at least 3 characters')
  }

  await db.execute({
    sql: `
			INSERT INTO BlockedHiveAccounts (hive_username, reason, blocked_by)
			VALUES (?, ?, ?)
			ON CONFLICT(hive_username) DO UPDATE SET
				reason = excluded.reason,
				blocked_by = excluded.blocked_by,
				blocked_at = CURRENT_TIMESTAMP
		`,
    args: [hiveUsername, params.reason ?? 'abuse', params.blockedBy],
  })

  return hiveUsername
}

export async function unblockHiveUsername(
  username: string
): Promise<string | null> {
  const hiveUsername = normalizeBlockedUsername(username)
  if (hiveUsername.length < 3) return null

  const result = await db.execute({
    sql: 'DELETE FROM BlockedHiveAccounts WHERE hive_username = ?',
    args: [hiveUsername],
  })

  return result.rowsAffected > 0 ? hiveUsername : null
}
