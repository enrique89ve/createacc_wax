import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AstroCookies } from 'astro'
import type { CreationSession } from '@/types/auth'
import { getRequiredEnvString } from '@/lib/env'
import { CREATION_SESSION_CONFIG, ENV_KEYS } from '@/consts/constants'
import { shouldUseSecureCookie } from '@/utils/cookie-helpers'

/**
 * Cookie-based session manager for account creation flow.
 * Inspired by Supabase SSR approach - uses signed cookies instead of Astro.session.
 *
 * This avoids the need for an external session storage driver (Redis, etc.)
 * while maintaining security through httpOnly and HMAC-SHA256 signed cookies.
 *
 * Security features:
 * - HMAC-SHA256 cryptographic signing
 * - Timing-safe signature comparison
 * - URL-safe base64url encoding
 * - httpOnly + sameSite=strict cookies
 *
 * RUNTIME REQUIREMENTS:
 * - Requires Node.js runtime - node:crypto module must be available
 * - Runs on @astrojs/node standalone server
 */

/**
 * Verify Node.js runtime compatibility on module load
 * This ensures node:crypto is available before any HMAC operations
 */
function verifyNodeRuntimeCompatibility(): void {
	try {
		// Test that node:crypto is available
		const testHmac = createHmac('sha256', 'test-key')
		testHmac.update('test-data')
		testHmac.digest('base64url')
	} catch (error) {
		const errorMessage =
			'[SessionCookie] CRITICAL: node:crypto not available. ' +
			'This module requires Node.js runtime with node:crypto support.'
		console.error(errorMessage, {
			error: error instanceof Error ? error.message : 'Unknown error',
			timestamp: new Date().toISOString(),
		})
		throw new Error(errorMessage)
	}
}

// Verify runtime compatibility on module load
verifyNodeRuntimeCompatibility()

/**
 * Sign data using HMAC-SHA256
 * @param data - Data to sign (base64url encoded session)
 * @returns Signed data in format: data.signature
 */
function signData(data: string): string {
	const secret = getRequiredEnvString(ENV_KEYS.SESSION_SECRET)
	const hmac = createHmac(CREATION_SESSION_CONFIG.SIGNATURE_ALGORITHM, secret)
	hmac.update(data)
	const signature = hmac.digest('base64url')
	return `${data}.${signature}`
}

/**
 * Verify and extract data from signed string
 * Uses timing-safe comparison to prevent timing attacks
 * @param signedData - Signed data in format: data.signature
 * @returns Original data if signature valid, null otherwise
 */
function verifySignedData(signedData: string): string | null {
	try {
		const [data, signature] = signedData.split('.')
		if (!data || !signature) {
			console.warn('[SessionCookie] Invalid signed data format')
			return null
		}

		const secret = getRequiredEnvString(
			ENV_KEYS.SESSION_SECRET
		)
		const hmac = createHmac(CREATION_SESSION_CONFIG.SIGNATURE_ALGORITHM, secret)
		hmac.update(data)
		const expectedSignature = hmac.digest('base64url')

		// Timing-safe comparison to prevent timing attacks
		const expectedBuffer = Buffer.from(expectedSignature, 'base64url')
		const actualBuffer = Buffer.from(signature, 'base64url')

		if (expectedBuffer.length !== actualBuffer.length) {
			console.warn('[SessionCookie] Signature length mismatch')
			return null
		}

		if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
			console.warn('[SessionCookie] Signature verification failed')
			return null
		}

		return data
	} catch (error) {
		console.error('[SessionCookie] Error verifying signature:', {
			error: error instanceof Error ? error.message : 'Unknown error',
			timestamp: new Date().toISOString(),
		})
		return null
	}
}

/**
 * Encode session data to base64url JSON (URL-safe)
 */
function encodeSession(session: CreationSession): string {
	const json = JSON.stringify(session)
	return Buffer.from(json, 'utf-8').toString('base64url')
}

/**
 * Decode session data from base64url JSON
 */
function decodeSession(encoded: string): CreationSession | null {
	try {
		const json = Buffer.from(encoded, 'base64url').toString('utf-8')
		const data = JSON.parse(json) as CreationSession

		// Validate required fields
		if (!data.username || typeof data.username !== 'string') {
			console.warn('[SessionCookie] Invalid session data: missing username')
			return null
		}

		return data
	} catch (error) {
		console.error('[SessionCookie] Error decoding session:', {
			error: error instanceof Error ? error.message : 'Unknown error',
			timestamp: new Date().toISOString(),
		})
		return null
	}
}

/**
 * Save creation session to a signed cookie
 * @param cookies - Astro cookies instance
 * @param session - Session data to store
 * @param request - Optional request for HTTPS detection
 */
export function setCreationCookie(
	cookies: AstroCookies,
	session: CreationSession,
	request?: Request
): void {
	const encoded = encodeSession(session)
	const signed = signData(encoded)

	cookies.set(CREATION_SESSION_CONFIG.COOKIE_NAME, signed, {
		httpOnly: true,
		sameSite: 'strict',
		path: '/',
		maxAge: CREATION_SESSION_CONFIG.MAX_AGE_SECONDS,
		secure: shouldUseSecureCookie(request),
	})
}

/**
 * Retrieve creation session from signed cookie
 * @param cookies - Astro cookies instance
 * @returns Session data if valid, null otherwise
 */
export function getCreationCookie(cookies: AstroCookies): CreationSession | null {
	try {
		const cookie = cookies.get(CREATION_SESSION_CONFIG.COOKIE_NAME)
		if (!cookie?.value) return null

		const verified = verifySignedData(cookie.value)
		if (!verified) return null

		return decodeSession(verified)
	} catch (error) {
		console.error('[SessionCookie] Error retrieving cookie:', {
			error: error instanceof Error ? error.message : 'Unknown error',
			timestamp: new Date().toISOString(),
		})
		return null
	}
}

/**
 * Clear creation session cookie
 * @param cookies - Astro cookies instance
 */
export function clearCreationCookie(cookies: AstroCookies): void {
	cookies.delete(CREATION_SESSION_CONFIG.COOKIE_NAME, {
		path: '/',
	})
}

/**
 * Update creation session with partial data
 */
export function updateCreationCookie(
	cookies: AstroCookies,
	partial: Partial<CreationSession>,
	request?: Request
): void {
	const existing = getCreationCookie(cookies)
	if (!existing) {
		throw new Error('Cannot update non-existent creation session')
	}

	const updated = { ...existing, ...partial }
	setCreationCookie(cookies, updated, request)
}

/**
 * F6 FIX: Sign a simple string value with HMAC-SHA256.
 * Used for signing cookies like success_account.
 *
 * Encodes value as base64url BEFORE signing to avoid split('.')
 * collisions when the value contains dots (e.g. Hive usernames like "user.name").
 */
export function signValue(value: string): string {
	const encoded = Buffer.from(value, 'utf-8').toString('base64url')
	return signData(encoded)
}

/**
 * F6 FIX: Verify and extract a signed string value.
 * Returns the original value if signature is valid, null otherwise.
 *
 * Decodes base64url AFTER verification to recover original value.
 */
export function verifySignedValue(signedValue: string): string | null {
	const verified = verifySignedData(signedValue)
	if (!verified) return null
	try {
		return Buffer.from(verified, 'base64url').toString('utf-8')
	} catch {
		return null
	}
}
