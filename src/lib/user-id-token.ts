/**
 * Signed user-id token.
 * Clients never send raw user UUIDs; they send HMAC-bound refs.
 * Server verifies with SESSION_SECRET (timing-safe) before any mutation.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { CREATION_SESSION_CONFIG, ENV_KEYS } from '@/consts/constants'
import { getRequiredEnvString } from '@/lib/env'

const USER_ID_TOKEN_PURPOSE = 'user-id-v1'

export type UserIdToken = string & { readonly __brand: unique symbol }

function hmacForUserId(userId: string): Buffer {
	const secret = getRequiredEnvString(ENV_KEYS.SESSION_SECRET)
	return createHmac(CREATION_SESSION_CONFIG.SIGNATURE_ALGORITHM, secret)
		.update(`${USER_ID_TOKEN_PURPOSE}:${userId}`)
		.digest()
}

function buffersEqual(left: Buffer, right: Buffer): boolean {
	if (left.length !== right.length) return false
	return timingSafeEqual(left, right)
}

export function signUserId(userId: string): UserIdToken {
	if (!userId) {
		throw new Error('Cannot sign an empty user id')
	}

	const payload = Buffer.from(userId, 'utf8').toString('base64url')
	const signature = hmacForUserId(userId).toString('base64url')
	return `${payload}.${signature}` as UserIdToken
}

export function verifyUserIdToken(token: string): string | null {
	if (typeof token !== 'string') return null

	const separator = token.indexOf('.')
	if (separator <= 0 || separator === token.length - 1) return null

	const payload = token.slice(0, separator)
	const signature = token.slice(separator + 1)

	let userId: string
	try {
		userId = Buffer.from(payload, 'base64url').toString('utf8')
	} catch {
		return null
	}

	if (!userId) return null

	let actual: Buffer
	try {
		actual = Buffer.from(signature, 'base64url')
	} catch {
		return null
	}

	if (!buffersEqual(hmacForUserId(userId), actual)) return null
	return userId
}

export function userIdTokenMatchesSession(
	token: string,
	sessionUserId: string
): boolean {
	const userId = verifyUserIdToken(token)
	if (!userId) return false

	const left = Buffer.from(userId, 'utf8')
	const right = Buffer.from(sessionUserId, 'utf8')
	return buffersEqual(left, right)
}

export function parseClientUserRef(raw: string | undefined | null): string | null {
	if (!raw) return null
	return verifyUserIdToken(raw)
}
