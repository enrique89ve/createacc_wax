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
 * an external storage driver (Redis, etc.).
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
