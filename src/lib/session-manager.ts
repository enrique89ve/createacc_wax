import type { CreationSession } from '@/types/auth'
import type { AstroCookies } from 'astro'
import {
	getCreationCookie,
	setCreationCookie,
	clearCreationCookie,
	updateCreationCookie,
} from '@/lib/session-cookies'

/**
 * Type-safe session manager for the public account creation flow.
 * Now uses signed cookies instead of Astro.session to avoid requiring
 * a storage driver (Vercel KV, Redis, etc.).
 *
 * Inspired by Supabase SSR approach used by midudev.
 */
export class CreationSessionManager {
	constructor(
		private readonly cookies: AstroCookies,
		private readonly request?: Request
	) {}

	get(): CreationSession | null {
		return getCreationCookie(this.cookies)
	}

	set(data: CreationSession): void {
		setCreationCookie(this.cookies, data, this.request)
	}

	update(partial: Partial<CreationSession>): void {
		updateCreationCookie(this.cookies, partial, this.request)
	}

	clear(): void {
		clearCreationCookie(this.cookies)
	}
}

/**
 * Type guard to check if session data is valid CreationSession
 */
export function isValidCreationSession(data: unknown): data is CreationSession {
  return (
    typeof data === 'object' &&
    data !== null &&
    'username' in data &&
    typeof (data as Record<string, unknown>).username === 'string'
  )
}
