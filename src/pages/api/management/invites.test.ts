import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createContext } from 'astro/middleware'
import { PUT } from './invites'
import { getFreshAdminSession } from '@/lib/auth/admin-auth'
import { updateInviteCampaignSettings } from '@/lib/invite/campaign-settings'
import { UserRole } from '@/lib/roles'
import { getMessages } from '@/i18n'

vi.mock('@/lib/auth/admin-auth', () => ({
  getFreshAdminSession: vi.fn(),
}))
vi.mock('@/lib/invite/config', () => ({
  getInviteConfiguration: () => ({
    identitySecret: 'a1'.repeat(32),
    providers: { github: { clientId: 'test', clientSecret: 'test' } },
  }),
}))
vi.mock('@/lib/invite/schema', () => ({
  hasInviteSchema: async () => true,
  requireInviteSchemaKey: async () => {},
}))
vi.mock('@/lib/invite/campaign-settings', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/invite/campaign-settings')>()),
  updateInviteCampaignSettings: vi.fn(),
}))

const actor = {
  userId: 'current-admin',
  username: 'admin',
  role: UserRole.Admin,
  loginTime: Date.now(),
} as const
const command = {
  enabled: true,
  total_limit: 5,
  expected_revision: 0,
  request_id: '62d2a30b-24f3-4978-b6f2-8493fc50995a',
  reason: 'Open campaign',
}

function context(origin = 'https://join.holahive.com') {
  return createContext({
    defaultLocale: 'en',
    clientAddress: '127.0.0.1',
    request: new Request('https://join.holahive.com/api/management/invites', {
      method: 'PUT',
      headers: { origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    }),
    locals: {
      adminUser: { ...actor, userId: 'cached-admin' },
      locale: 'en',
      messages: getMessages('en'),
    },
  })
}

beforeEach(() => vi.resetAllMocks())

describe('invitation campaign mutation authorization', () => {
  it('rejects a revoked session even when locals contain a cached admin', async () => {
    vi.mocked(getFreshAdminSession).mockResolvedValue({
      kind: 'unauthenticated',
    })
    const response = await PUT(context())
    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(updateInviteCampaignSettings).not.toHaveBeenCalled()
  })

  it('fails closed when the current session cannot be verified', async () => {
    vi.mocked(getFreshAdminSession).mockResolvedValue({ kind: 'unavailable' })
    expect((await PUT(context())).status).toBe(503)
    expect(updateInviteCampaignSettings).not.toHaveBeenCalled()
  })

  it('rejects a cross-origin command before verifying the session', async () => {
    expect((await PUT(context('https://attacker.invalid'))).status).toBe(403)
    expect(getFreshAdminSession).not.toHaveBeenCalled()
    expect(updateInviteCampaignSettings).not.toHaveBeenCalled()
  })

  it('records the freshly authenticated actor rather than the cached actor', async () => {
    vi.mocked(getFreshAdminSession).mockResolvedValue({
      kind: 'authenticated',
      session: actor,
    })
    vi.mocked(updateInviteCampaignSettings).mockResolvedValue({
      disposition: 'applied',
      actionLogId: 1,
      settings: { enabled: true, totalLimit: 5, issuedCount: 0, revision: 1 },
    })
    expect((await PUT(context())).status).toBe(200)
    expect(updateInviteCampaignSettings).toHaveBeenCalledWith(actor, command)
  })
})
