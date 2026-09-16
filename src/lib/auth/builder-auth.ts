import { createHash, randomBytes } from 'node:crypto'
import { db } from '@/lib/database'
import { UserRole } from '@/lib/roles'
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
const TIMESTAMP_MAX_DIFF_MS = 2 * 60 * 1000
const LOGIN_MESSAGE_REGEX =
  /Login to HiveAccount Creation at .+\nUsername: (.+)\nTimestamp: (\d+)\nNonce: ([a-f0-9]{64})$/

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
  readonly message: string
  readonly publicKey: string
  readonly signature: string
}

function hashNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex')
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

export async function createBuilderChallenge(): Promise<{
  nonce: string
  expiresAt: number
}> {
  const nonce = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + NONCE_TTL_MS

  await db.execute({
    sql: 'DELETE FROM BuilderAuthChallenges WHERE expires_at <= ?',
    args: [Date.now()],
  })

  await db.execute({
    sql: 'INSERT INTO BuilderAuthChallenges (nonce_hash, expires_at) VALUES (?, ?)',
    args: [hashNonce(nonce), expiresAt],
  })

  return { nonce, expiresAt }
}

export async function consumeBuilderChallenge(nonce: string): Promise<boolean> {
  const result = await db.execute({
    sql: `
			DELETE FROM BuilderAuthChallenges
			WHERE nonce_hash = ? AND expires_at > ?
		`,
    args: [hashNonce(nonce), Date.now()],
  })

  return result.rowsAffected === 1
}

async function isAdminUsername(username: string): Promise<boolean> {
  const result = await db.execute({
    sql: 'SELECT 1 FROM "user" WHERE username = ? AND role = ? LIMIT 1',
    args: [username, UserRole.Admin],
  })
  return result.rows.length > 0
}

export async function verifyBuilderLogin(
  input: BuilderAuthVerifyInput
): Promise<BuilderAuthResult<BuilderSession>> {
  if (!input.username || !input.message) {
    return { ok: false, error: 'Username and message are required' }
  }

  const username = createHiveUsername(input.username)
  if (await isAdminUsername(username)) {
    return { ok: false, error: 'Administrators must use password login' }
  }

  const match = input.message.match(LOGIN_MESSAGE_REGEX)
  if (!match) {
    return { ok: false, error: 'Invalid message format' }
  }

  const messageUsername = match[1]
  const messageTimestamp = Number.parseInt(match[2], 10)
  const messageNonce = match[3]

  if (messageUsername !== username) {
    return { ok: false, error: 'Username does not match the message' }
  }

  if (!(await consumeBuilderChallenge(messageNonce))) {
    return {
      ok: false,
      error: 'Invalid, expired or already used nonce. Please try again.',
    }
  }

  if (Math.abs(Date.now() - messageTimestamp) > TIMESTAMP_MAX_DIFF_MS) {
    return {
      ok: false,
      error:
        'Your device time is out of sync. Please check your clock and try again.',
    }
  }

  const signatureResult = await quickVerifySignature({
    username,
    message: createHiveMessage(input.message),
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
