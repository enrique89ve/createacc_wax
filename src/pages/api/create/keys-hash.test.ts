import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContext } from 'astro/middleware'
import { POST } from './keys-hash'
import { getMessages } from '@/i18n'
import { getCreationCookie } from '@/lib/session-cookies'
import { hashCreationIntent } from '@/lib/create/confirmed-public-keys'
import { confirmKeysDownloaded } from '@/lib/details/download-handler'
import type { CreationSession } from '@/types/auth'

const publicKeys = vi.hoisted(() => ({
  ownerPublicKey: 'STMowner',
  activePublicKey: 'STMactive',
  postingPublicKey: 'STMposting',
  memoPublicKey: 'STMmemo',
}))
vi.mock('@/utils/key-validation', () => ({
  validateHiveKeySet: () => publicKeys,
}))
vi.mock('@/lib/creation-rate-limiter', () => ({
  checkCreationRateLimit: () => ({ allowed: true }),
}))
function context(creation: CreationSession) {
  return createContext({
    defaultLocale: 'en',
    clientAddress: '127.0.0.1',
    request: new Request('https://localhost/api/create/keys-hash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...publicKeys,
        executionMode: 'broadcast',
        creationIntentHash: 'forged',
      }),
    }),
    locals: { creation, locale: 'en', messages: getMessages('en') },
  })
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('key confirmation intent binding', () => {
  it.each(['simulate', 'broadcast'] as const)(
    'signs the server-selected %s mode and returns a client-readable confirmation',
    async executionMode => {
      vi.stubEnv('HIVE_TX_MODE', executionMode)
      const creation = { username: 'alice', ticket: 'TICKET-1', executionMode }
      const ctx = context(creation)
      const response = await POST(ctx)
      expect(response.status).toBe(200)
      const creationIntentHash = hashCreationIntent({ ...creation, publicKeys })
      expect(getCreationCookie(ctx.cookies)).toMatchObject({
        executionMode,
        creationIntentHash,
        confirmedDownload: true,
      })
      const body: unknown = await response.clone().json()
      expect(body).toMatchObject({
        data: { executionMode, creationIntentHash },
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response)
      )
      expect(
        await confirmKeysDownloaded(publicKeys, async () => false)
      ).toEqual({ status: 'confirmed' })
    }
  )
  it.each([
    { username: 'alice', ticket: 'TICKET-1', executionMode: 'simulate' },
    { username: 'alice', ticket: 'TICKET-1' },
    { username: 'alice', executionMode: 'broadcast' },
  ] satisfies CreationSession[])(
    'rejects cross-mode, legacy or ticketless sessions',
    async creation => {
      vi.stubEnv('HIVE_TX_MODE', 'broadcast')
      const ctx = context(creation)
      expect((await POST(ctx)).status).toBe(409)
      expect(getCreationCookie(ctx.cookies)).toBeNull()
    }
  )
})
