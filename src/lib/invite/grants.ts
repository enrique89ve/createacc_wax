import { randomBytes } from 'node:crypto'
import { z } from 'astro/zod'
import { execute, withTransaction } from '@/lib/database'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { auditRepository } from '@/lib/repositories/audit-repository'
import { UserRole } from '@/lib/roles'
import { hashInviteToken, inviteLinkToken } from './crypto'
import { hasInviteSchema, requireInviteSchemaKey } from './schema'
import type {
  InviteGrant,
  InviteIdentity,
  InviteIssueResult,
  InviteState,
} from './types'

const GrantRowSchema = z.object({
  identity_hash: z.string().regex(/^[a-f0-9]{64}$/),
  provider: z.enum(['github', 'twitter']),
  token_hash: z.string().regex(/^[a-f0-9]{64}$/),
  ticket_id: z.number().int().positive(),
  code: z.string().min(1),
  issued_at: z.string().min(1),
})

function parseGrant(row: unknown): InviteGrant {
  const data = GrantRowSchema.parse(row)
  return {
    identityHash: data.identity_hash,
    provider: data.provider,
    tokenHash: data.token_hash,
    ticketId: data.ticket_id,
    ticketCode: data.code,
    issuedAt: data.issued_at,
  }
}

export async function findInviteGrant(
  identity: InviteIdentity
): Promise<InviteGrant | null> {
  const result = await execute({
    sql: `SELECT g.*, t.code FROM InviteGrants g JOIN Tickets t ON t.id = g.ticket_id
          WHERE g.identity_hash = ? AND g.provider = ?`,
    args: [identity.identityHash, identity.provider],
  })
  return result.rows[0] ? parseGrant(result.rows[0]) : null
}

async function activeIssuer(): Promise<{
  readonly id: string
  readonly username: string
} | null> {
  const result = await execute({
    sql: 'SELECT id, username FROM "user" WHERE role = ? AND is_active = 1 LIMIT 1',
    args: [UserRole.Admin],
  })
  const row = result.rows[0]
  return typeof row?.id === 'string' && typeof row.username === 'string'
    ? { id: row.id, username: row.username }
    : null
}

async function createGrant(
  identity: InviteIdentity,
  secret: string
): Promise<InviteGrant | null> {
  const issuer = await activeIssuer()
  if (!issuer) return null
  const tokenHash = hashInviteToken(inviteLinkToken(secret, identity))
  if (!tokenHash) throw new Error('Failed to derive invitation link')
  const ticket = await ticketsRepository.create({
    code: randomBytes(12).toString('hex').toUpperCase(),
    description: 'Personal social invitation',
    total_uses: 1,
    remaining_uses: 1,
    creator_username: issuer.username,
    funding_source: 'system',
    issuer_admin_id: issuer.id,
  })
  await execute({
    sql: 'INSERT INTO InviteGrants (identity_hash, provider, token_hash, ticket_id) VALUES (?, ?, ?, ?)',
    args: [identity.identityHash, identity.provider, tokenHash, ticket.id],
  })
  await auditRepository.createTicketLog({
    ticketId: ticket.id,
    ticket: ticket.code,
    action: 'create',
    actorType: 'system',
    actorId: 'invite',
    afterUses: 1,
    afterState: { fundingSource: 'system', provider: identity.provider },
    operationReference: `ticket:${ticket.id}:invite`,
    performedBy: 'invite',
  })
  return findInviteGrant(identity)
}

export async function issueInviteGrant(
  identity: InviteIdentity,
  secret: string
): Promise<InviteIssueResult> {
  return withTransaction(async () => {
    await requireInviteSchemaKey(secret)
    const existing = await findInviteGrant(identity)
    if (existing) return { kind: 'existing', grant: existing }
    const settings = await execute({
      sql: 'SELECT campaign_enabled, campaign_limit FROM InviteSettings WHERE singleton = 1',
      args: [],
    })
    const enabled = settings.rows[0]?.campaign_enabled
    const limit = Number(settings.rows[0]?.campaign_limit)
    if (
      (enabled !== 0 && enabled !== 1) ||
      !Number.isSafeInteger(limit) ||
      limit < 0
    ) {
      return { kind: 'unavailable' }
    }
    if (enabled !== 1) return { kind: 'campaign_disabled' }
    const count = await execute({
      sql: 'SELECT COUNT(*) AS count FROM InviteGrants',
      args: [],
    })
    if (Number(count.rows[0]?.count) >= limit) {
      return { kind: 'quota_exhausted' }
    }
    const grant = await createGrant(identity, secret)
    return grant ? { kind: 'issued', grant } : { kind: 'unavailable' }
  })
}

/** Also called inside the ticket reservation transaction. Regular tickets need no social login. */
export async function canUseInviteTicket(
  ticketCode: string,
  identityHash?: string
): Promise<boolean> {
  if (!(await hasInviteSchema())) return true
  const result = await execute({
    sql: 'SELECT g.identity_hash FROM InviteGrants g JOIN Tickets t ON t.id = g.ticket_id WHERE t.code = ?',
    args: [ticketCode],
  })
  return !result.rows[0] || result.rows[0].identity_hash === identityHash
}

export async function inviteGrantState(
  grant: InviteGrant
): Promise<InviteState> {
  const accounts = await execute({
    sql: 'SELECT username, blockchain_status FROM Accounts WHERE ticket_id = ? LIMIT 1',
    args: [grant.ticketId],
  })
  const account = accounts.rows[0]
  if (typeof account?.username === 'string') {
    const confirmed =
      account.blockchain_status === 'confirmed' ||
      account.blockchain_status === 'simulated'
    return {
      kind: confirmed ? 'completed' : 'processing',
      username: account.username,
    }
  }
  const attempts = await execute({
    sql: "SELECT username FROM CreationAttempts WHERE ticket_id = ? AND status IN ('reserved', 'prepared', 'broadcasting') ORDER BY created_at DESC LIMIT 1",
    args: [grant.ticketId],
  })
  if (typeof attempts.rows[0]?.username === 'string') {
    return { kind: 'processing', username: attempts.rows[0].username }
  }
  const ticket = await execute({
    sql: 'SELECT remaining_uses, revoked_at, archived_at FROM Tickets WHERE id = ?',
    args: [grant.ticketId],
  })
  const row = ticket.rows[0]
  return row?.remaining_uses === 1 &&
    row.revoked_at === null &&
    row.archived_at === null
    ? { kind: 'available', grant }
    : { kind: 'unavailable' }
}
