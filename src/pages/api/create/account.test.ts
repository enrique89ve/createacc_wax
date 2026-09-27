import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createContext } from 'astro/middleware'
import { getMessages } from '@/i18n'
import { POST } from './account'
import { getAccountCreationState } from '@/utils/db-ticket-validator'
import {
  getAccountCreationAttempt,
  getOpenCreationAttemptByUsername,
  type CreationAttempt,
} from '@/lib/creation-attempts'
import {
  hashCreationIntent,
  hashConfirmedPublicKeys,
} from '@/lib/create/confirmed-public-keys'
import { getCreationCookie } from '@/lib/session-cookies'
import { runAccountCreationPreflight } from '@/lib/hive-preflight'
import type { CreationSession } from '@/types/auth'
import type { HiveExecutionMode } from '@/consts/hive-execution'

const fixture = vi.hoisted(() => ({
  username: 'audituser',
  ownerPublicKey: 'STMowner',
  activePublicKey: 'STMactive',
  postingPublicKey: 'STMposting',
  memoPublicKey: 'STMmemo',
}))
vi.mock('@/lib/pow', () => ({
  validatePowSolution: () => true,
  validateTimingToken: () => true,
}))
vi.mock('@/lib/creation-rate-limiter', () => ({
  checkCreationRateLimit: () => ({ allowed: true }),
}))
vi.mock('@/utils/check-username', () => ({
  checkHiveAccountFormat: async () => ({ valid: true }),
}))
vi.mock('@/lib/username-policy', () => ({
  checkUsernamePolicy: async () => ({ status: 'allowed' }),
}))
vi.mock('@/lib/hive-preflight', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/hive-preflight')>()),
  runAccountCreationPreflight: vi.fn(async () => {
    throw new Error('Unexpected preflight in idempotency test')
  }),
}))
vi.mock('@/lib/create/create-account', () => ({
  createAccount: vi.fn(async () => {
    throw new Error('Broadcast forbidden in route test')
  }),
}))
vi.mock('@/lib/create/account-creation.validator', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/lib/create/account-creation.validator')
  >()),
  validateRequestData: () => ({ success: true, data: fixture }),
}))
vi.mock('@/utils/db-ticket-validator', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/db-ticket-validator')>()),
  getAccountCreationState: vi.fn(),
}))
vi.mock('@/lib/creation-attempts', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/creation-attempts')>()),
  getAccountCreationAttempt: vi.fn(),
  getOpenCreationAttemptByUsername: vi.fn(),
}))
function session(
  executionMode: HiveExecutionMode = 'simulate'
): CreationSession {
  return {
    username: fixture.username,
    confirmedDownload: true,
    ticket: 'AUDIT-TICKET',
    executionMode,
    confirmedPublicKeysHash: hashConfirmedPublicKeys(fixture),
    creationIntentHash: hashCreationIntent({
      username: fixture.username,
      ticket: 'AUDIT-TICKET',
      publicKeys: fixture,
      executionMode,
    }),
  }
}
function context(
  creation = session(),
  bodyFields: Readonly<Record<string, unknown>> = {}
) {
  return createContext({
    request: new Request('http://localhost/api/create/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...fixture,
        pow: { challengeId: 'audit', nonce: '1' },
        timingTokenId: 'audit',
        ...bodyFields,
      }),
    }),
    params: {},
    defaultLocale: 'en',
    clientAddress: '127.0.0.1',
    locals: { creation, locale: 'en', messages: getMessages('en') },
  })
}
function attempt(overrides: Partial<CreationAttempt> = {}): CreationAttempt {
  return {
    correlationId: 'attempt-1',
    username: fixture.username,
    ticket: 'AUDIT-TICKET',
    ticketId: 1,
    fundingSource: 'system',
    ownerBuilderUsername: null,
    version: 1,
    leaseToken: null,
    leaseExpiresAt: null,
    leaseGeneration: 1,
    status: 'completed',
    keys: fixture,
    transactionId: 'tx1',
    transactionExpiresAt: null,
    executionMode: 'simulate',
    broadcasted: false,
    wax: {
      validated: true,
      onChainVerified: true,
      signed: true,
      authorityVerified: true,
    },
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('HIVE_TX_MODE', 'simulate')
  vi.mocked(getAccountCreationState).mockResolvedValue({
    username: fixture.username,
    executionMode: 'simulate',
    blockchainStatus: 'simulated',
    transactionId: 'tx1',
    waxStatus: 'passed',
  })
  vi.mocked(getAccountCreationAttempt).mockResolvedValue(attempt())
  vi.mocked(getOpenCreationAttemptByUsername).mockResolvedValue(null)
})
afterEach(() => {
  vi.unstubAllEnvs()
})
describe('account creation intent boundary', () => {
  it.each(['simulate', 'broadcast'] as const)(
    'finalizes a matching %s retry and allows the completed session to retry again',
    async executionMode => {
      vi.stubEnv('HIVE_TX_MODE', executionMode)
      vi.mocked(getAccountCreationState).mockResolvedValue({
        username: fixture.username,
        executionMode,
        blockchainStatus:
          executionMode === 'simulate' ? 'simulated' : 'confirmed',
        transactionId: 'tx1',
        waxStatus: 'passed',
      })
      vi.mocked(getAccountCreationAttempt).mockResolvedValue(
        attempt({ executionMode })
      )
      const ctx = context(session(executionMode))
      const response = await POST(ctx)
      expect(response.status).toBe(200)
      const body: unknown = await response.json()
      expect(body).toMatchObject({
        data: {
          executionMode,
          creationIntentHash: session(executionMode).creationIntentHash,
        },
      })
      const completed = getCreationCookie(ctx.cookies)
      expect(completed).toMatchObject({
        accountCreated: true,
        ticket: 'AUDIT-TICKET',
        executionMode,
      })
      if (!completed) throw new Error('Missing completed session')
      expect((await POST(context(completed))).status).toBe(200)
      expect(runAccountCreationPreflight).not.toHaveBeenCalled()
    }
  )
  it('rejects a simulated record in broadcast mode even with a fresh broadcast session', async () => {
    vi.stubEnv('HIVE_TX_MODE', 'broadcast')
    expect((await POST(context(session('broadcast')))).status).toBe(409)
    expect(runAccountCreationPreflight).not.toHaveBeenCalled()
  })
  it('rejects a simulated session replayed after switching to broadcast', async () => {
    vi.stubEnv('HIVE_TX_MODE', 'broadcast')
    expect((await POST(context())).status).toBe(409)
    expect(getAccountCreationState).not.toHaveBeenCalled()
  })
  it.each([
    { ticket: 'OTHER-TICKET' },
    { keys: { ...fixture, ownerPublicKey: 'STMforeign' } },
    { status: 'prepared' },
    { executionMode: 'broadcast' },
    { transactionId: 'tx-other' },
    { username: 'anotheruser' },
  ] satisfies Partial<CreationAttempt>[])(
    'rejects a mismatched persisted attempt: %j',
    async changes => {
      vi.mocked(getAccountCreationAttempt).mockResolvedValue(attempt(changes))
      expect((await POST(context())).status).toBe(409)
      expect(runAccountCreationPreflight).not.toHaveBeenCalled()
    }
  )
  it('rejects an account without a persisted attempt', async () => {
    vi.mocked(getAccountCreationAttempt).mockResolvedValue(null)
    expect((await POST(context())).status).toBe(409)
  })
  it('rejects an open attempt from another mode before preflight or recovery', async () => {
    vi.mocked(getAccountCreationState).mockResolvedValue(null)
    vi.mocked(getOpenCreationAttemptByUsername).mockResolvedValue(
      attempt({ executionMode: 'broadcast', status: 'broadcasting' })
    )
    expect((await POST(context())).status).toBe(409)
    expect(runAccountCreationPreflight).not.toHaveBeenCalled()
  })
  it('does not accept mode or hash overrides from the request body', async () => {
    const response = await POST(
      context(session(), {
        executionMode: 'broadcast',
        creationIntentHash: 'forged',
      })
    )
    expect(response.status).toBe(200)
    const body: unknown = await response.json()
    expect(body).toMatchObject({
      data: {
        executionMode: 'simulate',
        creationIntentHash: session().creationIntentHash,
      },
    })
  })
})
