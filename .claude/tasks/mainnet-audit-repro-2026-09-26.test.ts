import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContext } from 'astro/middleware'
import { POST } from '@/pages/api/create/account'
import { getAccountCreationState } from '@/utils/db-ticket-validator'
import { hashConfirmedPublicKeys } from '@/lib/create/confirmed-public-keys'
import { getCreationCookie } from '@/lib/session-cookies'
import { confirmKeysDownloaded } from '@/lib/details/download-handler'

const fixture = vi.hoisted(() => ({
  username: 'audituser',
  ownerPublicKey: 'STMowner', activePublicKey: 'STMactive',
  postingPublicKey: 'STMposting', memoPublicKey: 'STMmemo',
}))
vi.mock('@/lib/pow', () => ({ validatePowSolution: () => true, validateTimingToken: () => true }))
vi.mock('@/utils/check-username', () => ({ checkHiveAccountFormat: async () => ({ valid: true }) }))
vi.mock('@/lib/username-policy', () => ({ checkUsernamePolicy: async () => ({ status: 'allowed' }) }))
vi.mock('@/lib/create/account-creation.validator', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/create/account-creation.validator')>(),
  validateRequestData: () => ({ success: true, data: fixture }),
}))
vi.mock('@/utils/db-ticket-validator', async importOriginal => ({
  ...await importOriginal<typeof import('@/utils/db-ticket-validator')>(),
  getAccountCreationState: vi.fn(),
}))
function context(completed = false) {
  return createContext({
    request: new Request('http://localhost/api/create/account', { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fixture, pow: { challengeId: 'audit', nonce: '1' }, timingTokenId: 'audit' }),
    }),
    params: {}, clientAddress: '127.0.0.1',
    locals: { creation: { username: fixture.username, confirmedDownload: true,
      confirmedPublicKeysHash: hashConfirmedPublicKeys(fixture), accountCreated: completed,
      ...(completed ? {} : { ticket: 'AUDIT-TICKET' }),
    } },
  })
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('temporary audit reproductions - assertions describe current defects', () => {
  it('existing mainnet account returns success without finalizing the browser session', async () => {
    vi.mocked(getAccountCreationState).mockResolvedValue({ username: fixture.username, executionMode: 'broadcast', blockchainStatus: 'confirmed', transactionId: 'tx1', waxStatus: 'passed' })
    const ctx = context()
    const response = await POST(ctx)
    expect(response.status).toBe(200)
    expect(getCreationCookie(ctx.cookies)).toBeNull()
    expect(ctx.locals.creation?.accountCreated).toBe(false)
  })
  it('the completed session produced by finalizeSession is rejected on retry', async () => {
    const response = await POST(context(true))
    expect(response.ok).toBe(false)
    expect(await response.text()).toContain('A valid ticket is required to create an account')
  })
  it('a simulated database record is accepted as success when the runtime is broadcast', async () => {
    vi.stubEnv('HIVE_TX_MODE', 'broadcast')
    vi.mocked(getAccountCreationState).mockResolvedValue({ username: fixture.username, executionMode: 'simulate', blockchainStatus: 'simulated', transactionId: 'tx-sim', waxStatus: 'passed' })
    const response = await POST(context())
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('"executionMode":"simulate"')
  })
  it('HTML HTTP 200 is accepted as public key confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Unavailable</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })))
    expect(await confirmKeysDownloaded(fixture, async () => false)).toEqual({ status: 'confirmed' })
  })
})
