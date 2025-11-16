import type { CreationSession } from '@/types/auth'
import type { SessionContext } from '@/lib/session'
import { SESSION_KEYS } from '@/consts/constants'

/**
 * Type-safe session manager for the public account creation flow.
 * Keeps using Astro's built-in session storage while admin/auth flows
 * are handled by Auth.js.
 */
export class CreationSessionManager {
  constructor(private readonly context: SessionContext) {}

  async get(): Promise<CreationSession | null> {
    try {
      if (!this.context.session) return null

      const session = (await this.context.session.get(
        SESSION_KEYS.CREATE_FLOW
      )) as CreationSession | undefined
      if (!session || !session.username) return null

      return session
    } catch (error) {
      return null
    }
  }

  async set(data: CreationSession): Promise<void> {
    try {
      if (!this.context.session) return

      this.context.session.set(SESSION_KEYS.CREATE_FLOW, data)
    } catch (error) {
      throw error
    }
  }

  async update(partial: Partial<CreationSession>): Promise<void> {
    const existing = await this.get()
    if (!existing) {
      throw new Error('Cannot update non-existent creation session')
    }

    await this.set({ ...existing, ...partial })
  }

  async clear(): Promise<void> {
    try {
      if (!this.context.session) return

      this.context.session.set(SESSION_KEYS.CREATE_FLOW, null)
    } catch (error) {
      throw error
    }
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
