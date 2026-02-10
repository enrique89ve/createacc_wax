/**
 * Server-side rate limiter for login endpoints
 *
 * Uses persistent LoginAttempts table instead of in-memory state to:
 * - Survive server restarts
 * - Work across multiple instances sharing the same database
 * - Keep auditable login attempt history
 */

import { db } from '@/lib/database'

interface RateWindowStats {
	readonly failedCount: number
	readonly oldestAttemptUnix: number | null
}

export interface RateLimitCheckInput {
	readonly username: string
	readonly sourceKey: string
}

export interface RecordLoginAttemptInput {
	readonly username: string
	readonly sourceKey: string
	readonly role?: string
	readonly userAgent?: string | null
	readonly success: boolean
	readonly errorMessage?: string | null
}

interface FailedAttemptsAggregateRow {
	readonly failed_count?: number | string | null
	readonly oldest_attempt_unix?: number | string | null
}

type RateLimitResult =
	| { readonly allowed: true; readonly remaining: number }
	| {
			readonly allowed: false
			readonly remaining: 0
			readonly retryAfter: number
			readonly blockedBy: 'source' | 'username'
	  }

// Configuration
const MAX_ATTEMPTS_PER_SOURCE = 5
const MAX_ATTEMPTS_PER_USERNAME = 10
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const WINDOW_MINUTES = Math.floor(WINDOW_MS / 60000)
const LOOKBACK_WINDOW_SQL = `-${WINDOW_MINUTES} minutes`

const MAX_USERNAME_LENGTH = 50
const MAX_SOURCE_KEY_LENGTH = 120
const MAX_USER_AGENT_LENGTH = 255
const MAX_ERROR_LENGTH = 255

function toSafeString(
	value: string | null | undefined,
	maxLength: number,
	fallback = ''
): string {
	const normalized = (value ?? '').trim()
	if (!normalized) return fallback
	return normalized.slice(0, maxLength)
}

function normalizeUsername(username: string): string {
	return toSafeString(username.toLowerCase(), MAX_USERNAME_LENGTH, 'anonymous')
}

function normalizeSourceKey(sourceKey: string): string {
	return toSafeString(sourceKey, MAX_SOURCE_KEY_LENGTH, 'source:unknown')
}

function toNumberOrZero(value: unknown): number {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string') {
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : 0
	}
	return 0
}

function toNullableUnix(value: unknown): number | null {
	const parsed = toNumberOrZero(value)
	return parsed > 0 ? parsed : null
}

const ALLOWED_QUERY_FIELDS = ['username', 'ip_address'] as const
type LoginAttemptsField = (typeof ALLOWED_QUERY_FIELDS)[number]

async function getFailedAttemptsStats(
	field: LoginAttemptsField,
	value: string
): Promise<RateWindowStats> {
	if (!ALLOWED_QUERY_FIELDS.includes(field)) {
		throw new Error(`Invalid LoginAttempts field: ${field}`)
	}

	const result = await db.execute({
		sql: `SELECT
				COUNT(*) as failed_count,
				MIN(strftime('%s', attempted_at)) as oldest_attempt_unix
			FROM LoginAttempts
			WHERE auth_method = 'password'
				AND success = 0
				AND ${field} = ?
				AND attempted_at >= datetime('now', ?)`,
		args: [value, LOOKBACK_WINDOW_SQL],
	})

	const row = (result.rows[0] ?? {}) as FailedAttemptsAggregateRow
	return {
		failedCount: toNumberOrZero(row.failed_count),
		oldestAttemptUnix: toNullableUnix(row.oldest_attempt_unix),
	}
}

function calculateRetryAfterSeconds(oldestAttemptUnix: number | null): number {
	if (!oldestAttemptUnix) {
		return Math.ceil(WINDOW_MS / 1000)
	}

	const now = Date.now()
	const oldestAttemptMs = oldestAttemptUnix * 1000
	const retryAfterMs = oldestAttemptMs + WINDOW_MS - now
	return Math.max(1, Math.ceil(retryAfterMs / 1000))
}

/**
 * Check if a login attempt is allowed.
 *
 * Uses two sliding windows:
 * - by sourceKey (trusted IP or fallback fingerprint)
 * - by username
 */
export async function checkLoginRateLimit(
	input: RateLimitCheckInput
): Promise<RateLimitResult> {
	const username = normalizeUsername(input.username)
	const sourceKey = normalizeSourceKey(input.sourceKey)

	const [sourceStats, usernameStats] = await Promise.all([
		getFailedAttemptsStats('ip_address', sourceKey),
		getFailedAttemptsStats('username', username),
	])

	const blockedBySource = sourceStats.failedCount >= MAX_ATTEMPTS_PER_SOURCE
	const blockedByUsername =
		usernameStats.failedCount >= MAX_ATTEMPTS_PER_USERNAME

	const remainingBySource = Math.max(
		0,
		MAX_ATTEMPTS_PER_SOURCE - sourceStats.failedCount
	)
	const remainingByUsername = Math.max(
		0,
		MAX_ATTEMPTS_PER_USERNAME - usernameStats.failedCount
	)

	if (!blockedBySource && !blockedByUsername) {
		return {
			allowed: true,
			remaining: Math.min(remainingBySource, remainingByUsername),
		}
	}

	const retryAfterSource = blockedBySource
		? calculateRetryAfterSeconds(sourceStats.oldestAttemptUnix)
		: 0
	const retryAfterUsername = blockedByUsername
		? calculateRetryAfterSeconds(usernameStats.oldestAttemptUnix)
		: 0

	return {
		allowed: false,
		remaining: 0,
		retryAfter: Math.max(retryAfterSource, retryAfterUsername),
		blockedBy: blockedBySource ? 'source' : 'username',
	}
}

/**
 * Store login attempt in persistent audit table.
 */
export async function recordLoginAttempt(
	input: RecordLoginAttemptInput
): Promise<void> {
	const username = normalizeUsername(input.username)
	const sourceKey = normalizeSourceKey(input.sourceKey)
	const userAgent = toSafeString(
		input.userAgent ?? '',
		MAX_USER_AGENT_LENGTH,
		''
	)
	const errorMessage = toSafeString(
		input.errorMessage ?? '',
		MAX_ERROR_LENGTH,
		''
	)

	const role = toSafeString(input.role ?? '', MAX_USERNAME_LENGTH, 'admin')

	await db.execute({
		sql: `INSERT INTO LoginAttempts (
				username,
				role,
				auth_method,
				success,
				ip_address,
				user_agent,
				error_message
			) VALUES (?, ?, 'password', ?, ?, ?, ?)`,
		args: [
			username,
			role,
			input.success ? 1 : 0,
			sourceKey,
			userAgent || null,
			errorMessage || null,
		],
	})
}

/**
 * Get current rate limit configuration.
 */
export const RATE_LIMIT_CONFIG = {
	MAX_ATTEMPTS_PER_SOURCE,
	MAX_ATTEMPTS_PER_USERNAME,
	WINDOW_MS,
	WINDOW_MINUTES,
} as const
