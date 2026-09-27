import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContext } from 'astro/middleware'
import { POST } from './session'
import { getCreationCookie, setCreationCookie } from '@/lib/session-cookies'
import {
  hashCreationIntent,
  hashConfirmedPublicKeys,
} from '@/lib/create/confirmed-public-keys'
import type { CreationSession } from '@/types/auth'

vi.mock('@/lib/pow', () => ({
  validatePowSolution: () => true,
  validateTimingToken: () => true,
}))
vi.mock('@/lib/creation-rate-limiter', () => ({
  checkCreationRateLimit: () => ({ allowed: true }),
}))
vi.mock('@/utils/db-ticket-validator', () => ({
  validateTicketInDB: async () => ({ isValid: true }),
}))
const publicKeys = {
  ownerPublicKey: 'STMowner',
  activePublicKey: 'STMactive',
  postingPublicKey: 'STMposting',
  memoPublicKey: 'STMmemo',
}
const existing: CreationSession = {
  username: 'alice',
  ticket: 'TICKET-1',
  executionMode: 'simulate',
  confirmedDownload: true,
  confirmedPublicKeysHash: hashConfirmedPublicKeys(publicKeys),
  creationIntentHash: hashCreationIntent({
    username: 'alice',
    ticket: 'TICKET-1',
    executionMode: 'simulate',
    publicKeys,
  }),
}
function context(ticket = 'TICKET-1', creation?: CreationSession) {
  const ctx = createContext({
    defaultLocale: 'en',
    clientAddress: '127.0.0.1',
    request: new Request('https://localhost/api/create/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'alice',
        ticket,
        pow: { challengeId: 'c', nonce: '1' },
        timingTokenId: 't',
        executionMode: 'broadcast',
        creationIntentHash: 'forged',
      }),
    }),
  })
  if (creation) setCreationCookie(ctx.cookies, creation, ctx.request)
  return ctx
}
afterEach(() => {
  vi.unstubAllEnvs()
})
describe('creation session mode ownership', () => {
  it('ignores client-supplied mode and fingerprint for a new session', async () => {
    vi.stubEnv('HIVE_TX_MODE', 'simulate')
    const ctx = context()
    expect((await POST(ctx)).status).toBe(200)
    expect(getCreationCookie(ctx.cookies)).toEqual({
      username: 'alice',
      ticket: 'TICKET-1',
      executionMode: 'simulate',
      confirmedDownload: false,
    })
  })
  it('preserves confirmation only when the ticket and mode stay the same', async () => {
    vi.stubEnv('HIVE_TX_MODE', 'simulate')
    const ctx = context('TICKET-1', existing)
    expect((await POST(ctx)).status).toBe(200)
    expect(getCreationCookie(ctx.cookies)).toEqual(existing)
  })
  it('drops confirmed keys and intent when replacing the ticket', async () => {
    vi.stubEnv('HIVE_TX_MODE', 'simulate')
    const ctx = context('TICKET-2', existing)
    expect((await POST(ctx)).status).toBe(200)
    expect(getCreationCookie(ctx.cookies)).toEqual({
      username: 'alice',
      ticket: 'TICKET-2',
      executionMode: 'simulate',
      confirmedDownload: false,
    })
  })
  it('requires a fresh confirmation after the server changes mode', async () => {
    vi.stubEnv('HIVE_TX_MODE', 'broadcast')
    const ctx = context('TICKET-1', existing)
    expect((await POST(ctx)).status).toBe(200)
    expect(getCreationCookie(ctx.cookies)).toEqual({
      username: 'alice',
      ticket: 'TICKET-1',
      executionMode: 'broadcast',
      confirmedDownload: false,
    })
  })
})
