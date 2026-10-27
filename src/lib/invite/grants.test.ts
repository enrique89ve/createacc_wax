import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase, insertAdminUser } from '@/lib/database'
import { initializeInviteSchema } from './schema'
import {
  canUseInviteTicket,
  issueInviteGrant,
  inviteGrantState,
} from './grants'
import { inviteIdentityHash } from './crypto'
import {
  reserveTicketCredit,
  rollbackTicketReservation,
  markTicketAsUsed,
} from '@/utils/db-ticket-validator'
import { claimCreationAttempt } from '@/lib/creation-attempts'
import type { InviteGrant, InviteIdentity } from './types'
import {
  getInviteCampaignSettings,
  updateInviteCampaignSettings,
} from './campaign-settings'
import { UserRole } from '@/lib/roles'

const secret = 'a1'.repeat(32)
const issued: InviteGrant[] = []
let adminId = ''
const correlations: string[] = []
const identity = (id: string): InviteIdentity => ({
  provider: 'github',
  identityHash: inviteIdentityHash(secret, 'github', id),
})

async function setCampaign(enabled: boolean, limit: number): Promise<void> {
  await db.execute({
    sql: 'UPDATE InviteSettings SET campaign_enabled = ?, campaign_limit = ?, revision = 0 WHERE singleton = 1',
    args: [enabled ? 1 : 0, limit],
  })
}

async function grantFor(id: string): Promise<InviteGrant> {
  const result = await issueInviteGrant(identity(id), secret)
  if (result.kind !== 'issued' && result.kind !== 'existing')
    throw new Error('Expected invitation grant')
  if (!issued.some(grant => grant.ticketId === result.grant.ticketId))
    issued.push(result.grant)
  return result.grant
}

describe('personal invitation grants', () => {
  beforeAll(async () => {
    expect(await initializeDatabase()).toBe(true)
    adminId = await insertAdminUser({
      username: 'inviteissuer',
      passwordHash: 'test-password-hash',
    })
    await initializeInviteSchema(secret)
  })
  beforeEach(async () => setCampaign(true, 100))
  afterAll(async () => {
    for (const correlationId of correlations) {
      await db.execute({
        sql: 'DELETE FROM CreationAttemptEvents WHERE correlation_id = ?',
        args: [correlationId],
      })
      await db.execute({
        sql: 'DELETE FROM CreationAttempts WHERE correlation_id = ?',
        args: [correlationId],
      })
    }
    for (const grant of issued) {
      await db.execute({
        sql: 'DELETE FROM Accounts WHERE ticket_id = ?',
        args: [grant.ticketId],
      })
      await db.execute({
        sql: 'DELETE FROM InviteGrants WHERE ticket_id = ?',
        args: [grant.ticketId],
      })
      await db.execute({
        sql: 'DELETE FROM TicketAudit WHERE ticket_id = ?',
        args: [grant.ticketId],
      })
      await db.execute({
        sql: 'DELETE FROM Tickets WHERE id = ?',
        args: [grant.ticketId],
      })
    }
    if (adminId) {
      await db.execute({
        sql: 'DELETE FROM AdminActionLog WHERE actor_user_id = ?',
        args: [adminId],
      })
      await db.execute({
        sql: 'DELETE FROM "user" WHERE id = ?',
        args: [adminId],
      })
    }
  })

  it('emits a single ticket under concurrent requests and recovers it after new service calls', async () => {
    await setCampaign(true, 1)
    const results = await Promise.all(
      Array.from({ length: 8 }, () => issueInviteGrant(identity('101'), secret))
    )
    expect(results.filter(result => result.kind === 'issued')).toHaveLength(1)
    expect(results.filter(result => result.kind === 'existing')).toHaveLength(7)
    const grant = await grantFor('101')
    expect(
      results.every(
        result =>
          (result.kind === 'issued' || result.kind === 'existing') &&
          result.grant.ticketId === grant.ticketId
      )
    ).toBe(true)
    expect(await issueInviteGrant(identity('102'), secret)).toEqual({
      kind: 'quota_exhausted',
    })
    await setCampaign(true, 2)
    expect((await grantFor('102')).ticketId).not.toBe(grant.ticketId)
  })

  it('rejects a changed identity key and prevents increasing the ticket capacity', async () => {
    const grant = await grantFor('103')
    await expect(
      issueInviteGrant(identity('103'), 'b2'.repeat(32))
    ).rejects.toThrow('identity key')
    await expect(initializeInviteSchema('b2'.repeat(32))).rejects.toThrow(
      'identity key'
    )
    await expect(
      db.execute({
        sql: 'UPDATE Tickets SET total_uses = 2 WHERE id = ?',
        args: [grant.ticketId],
      })
    ).rejects.toThrow('immutable')
  })

  it('checks ownership inside reservation, blocks double spending and restores only the same ticket on rollback', async () => {
    const grant = await grantFor('104')
    expect(await canUseInviteTicket(grant.ticketCode)).toBe(false)
    expect(
      await canUseInviteTicket(grant.ticketCode, identity('105').identityHash)
    ).toBe(false)
    expect(await markTicketAsUsed(grant.ticketCode)).toBe(false)
    const correlationId = crypto.randomUUID()
    correlations.push(correlationId)
    const input = {
      correlationId,
      ticketCode: grant.ticketCode,
      username: 'inviteaccount',
      executionMode: 'simulate' as const,
      keys: {
        ownerPublicKey: 'STMowner',
        activePublicKey: 'STMactive',
        postingPublicKey: 'STMposting',
        memoPublicKey: 'STMmemo',
      },
    }
    expect((await reserveTicketCredit(input)).success).toBe(false)
    expect(
      (
        await reserveTicketCredit({
          ...input,
          inviteIdentityHash: grant.identityHash,
        })
      ).success
    ).toBe(true)
    expect(await inviteGrantState(grant)).toEqual({
      kind: 'processing',
      username: 'inviteaccount',
    })
    expect(
      (
        await reserveTicketCredit({
          ...input,
          correlationId: crypto.randomUUID(),
          username: 'otheraccount',
          inviteIdentityHash: grant.identityHash,
        })
      ).success
    ).toBe(false)
    const lease = await claimCreationAttempt(correlationId)
    if (!lease) throw new Error('Expected creation lease')
    expect(
      (await rollbackTicketReservation(correlationId, lease)).success
    ).toBe(true)
    expect((await grantFor('104')).ticketId).toBe(grant.ticketId)
    expect((await inviteGrantState(grant)).kind).toBe('available')
  })

  it('recovers the spent invitation after completion without issuing another account allowance', async () => {
    const grant = await grantFor('106')
    await db.execute({
      sql: 'UPDATE Tickets SET remaining_uses = 0 WHERE id = ?',
      args: [grant.ticketId],
    })
    await db.execute({
      sql: `INSERT INTO Accounts (username, ticket, ticket_id, execution_mode, blockchain_status, rc_delegated, rc_status)
            VALUES ('invitecompleted', ?, ?, 'simulate', 'simulated', 0, 'pending')`,
      args: [grant.ticketCode, grant.ticketId],
    })
    expect(await inviteGrantState(grant)).toEqual({
      kind: 'completed',
      username: 'invitecompleted',
    })
    await setCampaign(false, 0)
    const recovered = await issueInviteGrant(identity('106'), secret)
    expect(recovered).toMatchObject({
      kind: 'existing',
      grant: { ticketId: grant.ticketId },
    })
    expect(await markTicketAsUsed(grant.ticketCode)).toBe(false)
  })

  it('starts paused and audits admin activation with optimistic revision', async () => {
    await setCampaign(false, 0)
    const defaults = await getInviteCampaignSettings()
    expect(defaults).toMatchObject({
      enabled: false,
      totalLimit: 0,
      revision: 0,
    })
    expect(await issueInviteGrant(identity('107'), secret)).toEqual({
      kind: 'campaign_disabled',
    })

    const actor = {
      userId: adminId,
      username: 'inviteissuer',
      role: UserRole.Admin,
      loginTime: Date.now(),
    } as const
    const command = {
      enabled: true,
      total_limit: 5,
      expected_revision: 0,
      request_id: crypto.randomUUID(),
      reason: 'Abrir la campaña inicial',
    }
    const changed = await updateInviteCampaignSettings(actor, command)
    expect(changed).toMatchObject({
      disposition: 'applied',
      settings: { enabled: true, totalLimit: 5, revision: 1 },
    })
    expect(await updateInviteCampaignSettings(actor, command)).toMatchObject({
      disposition: 'replayed',
      actionLogId: changed.actionLogId,
    })
    await expect(
      updateInviteCampaignSettings(actor, {
        ...command,
        request_id: crypto.randomUUID(),
      })
    ).rejects.toThrow('configuración cambió')
    await expect(
      updateInviteCampaignSettings(actor, {
        ...command,
        request_id: crypto.randomUUID(),
        expected_revision: 1,
        total_limit: 0,
      })
    ).rejects.toThrow('cupo mayor que cero')
  })
})
