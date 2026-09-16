import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/database'
import { UserRole } from '@/lib/roles'
import { BRAND } from '@/consts/branding'
import { quickVerifySignature } from '@/lib/admin/auth/hive-signature-verifier'
import {
  createHiveMessage,
  createHivePublicKey,
  createHiveSignature,
  createHiveUsername,
} from '@/types/hive-signature'
import { createBuilderSession } from '@/lib/auth/builder-session'
import type { BuilderSession } from '@/types/auth'

const NONCE_TTL_MS = 2 * 60 * 1000
const LOGIN_MESSAGE_PREFIX = 'Login to HiveAccount Creation at'

const CHALLENGE_RATE_LIMIT = {
  MAX_REQUESTS: 10,
  WINDOW_MS: 60 * 1000,
  MAX_ENTRIES: 10_000,
} as const

interface RateLimitEntry {
  count: number
  windowStart: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

export type BuilderAuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string }

export interface BuilderAuthVerifyInput {
  readonly username: string
  readonly publicKey: string
  readonly signature: string
  readonly message?: string
}

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
}

function normalizeHiveUsername(
  raw: string
): ReturnType<typeof createHiveUsername> {
  return createHiveUsername(raw.trim().replace(/^@/, ''))
}

export function canonicalAuthOrigin(): string {
  const fromEnv =
    process.env.AUTH_ORIGIN ??
    process.env.BETTER_AUTH_URL ??
    process.env.AUTH_URL
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim().replace(/\/$/, '')
  }
  if (process.env.NODE_ENV === 'production') {
    return BRAND.URL.replace(/\/$/, '')
  }
  return 'http://localhost:4321'
}

export function buildBuilderLoginMessage(params: {
  readonly origin: string
  readonly username: string
  readonly timestamp: number
  readonly nonce: string
}): string {
  return `${LOGIN_MESSAGE_PREFIX} ${params.origin}\nUsername: ${params.username}\nTimestamp: ${params.timestamp}\nNonce: ${params.nonce}`
}

function messagesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

function evictRateLimitIfNeeded(): void {
  if (rateLimitStore.size <= CHALLENGE_RATE_LIMIT.MAX_ENTRIES) return

  const now = Date.now()
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.windowStart > CHALLENGE_RATE_LIMIT.WINDOW_MS) {
      rateLimitStore.delete(ip)
    }
  }

  if (rateLimitStore.size > CHALLENGE_RATE_LIMIT.MAX_ENTRIES) {
    rateLimitStore.clear()
  }
}

export function checkChallengeRateLimit(clientIp: string): boolean {
  evictRateLimitIfNeeded()

  const now = Date.now()
  const entry = rateLimitStore.get(clientIp)

  if (!entry || now - entry.windowStart > CHALLENGE_RATE_LIMIT.WINDOW_MS) {
    rateLimitStore.set(clientIp, { count: 1, windowStart: now })
    return true
  }

  if (entry.count >= CHALLENGE_RATE_LIMIT.MAX_REQUESTS) {
    return false
  }

  entry.count++
  return true
}

async function isAdminUsername(username: string): Promise<boolean> {
  const result = await db.execute({
    sql: 'SELECT 1 FROM "user" WHERE username = ? AND role = ? LIMIT 1',
    args: [username, UserRole.Admin],
  })
  return result.rows.length > 0
}

export async function createBuilderChallenge(usernameInput: string): Promise<
  BuilderAuthResult<{
    username: string
    message: string
    expiresAt: number
  }>
> {
  const username = normalizeHiveUsername(usernameInput)
  if (username.length < 3) {
    return { ok: false, error: 'Username is required' }
  }

  if (await isAdminUsername(username)) {
    return { ok: false, error: 'Administrators must use password login' }
  }

  const nonce = randomBytes(32).toString('hex')
  const timestamp = Date.now()
  const expiresAt = timestamp + NONCE_TTL_MS
  const message = buildBuilderLoginMessage({
    origin: canonicalAuthOrigin(),
    username,
    timestamp,
    nonce,
  })

  await db.execute({
    sql: 'DELETE FROM BuilderAuthChallenges WHERE expires_at <= ?',
    args: [Date.now()],
  })

  await db.execute({
    sql: `
			INSERT INTO BuilderAuthChallenges (username, nonce_hash, message, expires_at)
			VALUES (?, ?, ?, ?)
			ON CONFLICT(username) DO UPDATE SET
				nonce_hash = excluded.nonce_hash,
				message = excluded.message,
				expires_at = excluded.expires_at
		`,
    args: [username, hashNonce(nonce), message, expiresAt],
  })

  return {
    ok: true,
    value: { username, message, expiresAt },
  }
}

export async function consumeBuilderChallenge(
  usernameInput: string
): Promise<string | null> {
  const username = normalizeHiveUsername(usernameInput)
  const result = await db.execute({
    sql: `
			DELETE FROM BuilderAuthChallenges
			WHERE username = ? AND expires_at > ?
			RETURNING message
		`,
    args: [username, Date.now()],
  })

  if (result.rows.length === 0) return null
  const message = (result.rows[0] as { message?: unknown }).message
  return typeof message === 'string' ? message : null
}

export async function verifyBuilderLogin(
  input: BuilderAuthVerifyInput
): Promise<BuilderAuthResult<BuilderSession>> {
  if (!input.username || !input.publicKey || !input.signature) {
    return {
      ok: false,
      error: 'Username, public key and signature are required',
    }
  }

  const username = normalizeHiveUsername(input.username)
  if (await isAdminUsername(username)) {
    return { ok: false, error: 'Administrators must use password login' }
  }

  const storedMessage = await consumeBuilderChallenge(username)
  if (!storedMessage) {
    return {
      ok: false,
      error: 'Invalid, expired or already used challenge. Please try again.',
    }
  }

  if (input.message && !messagesEqual(input.message, storedMessage)) {
    return { ok: false, error: 'Signed message does not match the challenge' }
  }

  const signatureResult = await quickVerifySignature({
    username,
    message: createHiveMessage(storedMessage),
    publicKey: createHivePublicKey(input.publicKey),
    signature: createHiveSignature(input.signature),
  })

  if (!signatureResult.valid) {
    return {
      ok: false,
      error: signatureResult.error || 'Invalid signature',
    }
  }

  return { ok: true, value: createBuilderSession(username) }
}
