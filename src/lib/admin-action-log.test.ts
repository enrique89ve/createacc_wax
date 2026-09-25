import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Permission } from './auth/permissions'
import {
  db,
  initializeDatabase,
  insertAdminUser,
  withTransaction,
} from './database'
import {
  type AdminMutationAction,
  appendAdminActionReceipt,
  findAdminActionReceipt,
  getBuilderModerationRevision,
  hashAdminActionCommand,
} from './admin-action-log'

const PREFIX = `admin-action-log-${Date.now()}`
let firstActorId = ''
const secondActorId = `${PREFIX}-other-actor`

function hashFor(params: {
  readonly requestId: string
  readonly action?: AdminMutationAction
  readonly reason?: string
  readonly targetType?: 'builder' | 'credits' | 'ticket'
  readonly targetId?: string
}) {
  return hashAdminActionCommand({
    action: params.action ?? Permission.ADJUST_CREDITS,
    targetType: params.targetType ?? 'credits',
    targetId: params.targetId ?? `${PREFIX}-builder`,
    normalizedCommand: {
      available_amount: 7,
      reason: params.reason ?? 'support correction',
    },
  })
}

describe('administrative action receipt persistence', () => {
  beforeAll(async () => {
    expect(await initializeDatabase()).toBe(true)
    firstActorId = await insertAdminUser({
      username: `${PREFIX}-first-admin`,
      passwordHash: 'test-password-hash',
    })
  })

  afterAll(async () => {
    await db.execute({
      sql: 'DELETE FROM AdminActionLog WHERE actor_user_id IN (?, ?)',
      args: [firstActorId, secondActorId],
    })
    await db.execute({
      sql: 'DELETE FROM "user" WHERE id = ?',
      args: [firstActorId],
    })
  })

  it('hashes normalized command objects independent of property order', () => {
    const first = hashAdminActionCommand({
      action: Permission.ADJUST_CREDITS,
      targetType: 'credits',
      targetId: 'builder-one',
      normalizedCommand: { available_amount: 3, reason: 'correction' },
    })
    const reordered = hashAdminActionCommand({
      action: Permission.ADJUST_CREDITS,
      targetType: 'credits',
      targetId: 'builder-one',
      normalizedCommand: { reason: 'correction', available_amount: 3 },
    })
    const changed = hashAdminActionCommand({
      action: Permission.ADJUST_CREDITS,
      targetType: 'credits',
      targetId: 'builder-one',
      normalizedCommand: { available_amount: 4, reason: 'correction' },
    })
    expect(first).toBe(reordered)
    expect(first).not.toBe(changed)
  })

  it('persists and retrieves the receipt with actor, reason, and state snapshots', async () => {
    const requestId = `${PREFIX}-adjust-once`
    const id = await appendAdminActionReceipt({
      actorUserId: firstActorId,
      actorUsername: `${PREFIX}-first-admin`,
      requestId,
      action: Permission.ADJUST_CREDITS,
      targetType: 'credits',
      targetId: `${PREFIX}-builder`,
      requestHash: hashFor({ requestId }),
      reason: '  support correction  ',
      outcome: 'applied',
      beforeState: { pending_amount: 2, available_amount: 1 },
      afterState: { pending_amount: 2, available_amount: 7 },
      receipt: { pending_amount: 2, available_amount: 7, revision: 5 },
    })

    const record = await findAdminActionReceipt({
      actorUserId: firstActorId,
      requestId,
    })
    expect(record).toMatchObject({
      id,
      actor_user_id: firstActorId,
      actor_username: `${PREFIX}-first-admin`,
      request_id: requestId,
      reason: 'support correction',
      outcome: 'applied',
      before_state: { pending_amount: 2, available_amount: 1 },
      after_state: { pending_amount: 2, available_amount: 7 },
      receipt: { pending_amount: 2, available_amount: 7, revision: 5 },
    })
    expect(
      await findAdminActionReceipt({ actorUserId: secondActorId, requestId })
    ).toBeNull()
  })

  it('scopes request lookup to an actor and enforces per-actor uniqueness', async () => {
    const requestId = `${PREFIX}-shared-id`
    const shared = {
      requestId,
      action: Permission.ASSIGN_CREDITS,
      targetType: 'builder' as const,
      targetId: `${PREFIX}-builder`,
      requestHash: hashFor({
        requestId,
        action: Permission.ASSIGN_CREDITS,
        targetType: 'builder',
      }),
      outcome: 'applied' as const,
      receipt: { granted: 4 },
    }
    await appendAdminActionReceipt({
      ...shared,
      actorUserId: firstActorId,
      actorUsername: `${PREFIX}-first-admin`,
    })
    expect(
      await findAdminActionReceipt({ actorUserId: secondActorId, requestId })
    ).toBeNull()
    await expect(
      appendAdminActionReceipt({
        ...shared,
        actorUserId: firstActorId,
        actorUsername: `${PREFIX}-first-admin`,
      })
    ).rejects.toThrow()
  })

  it('derives moderation revision from applied transitions only', async () => {
    const username = `${PREFIX}-moderated-builder`
    expect(await getBuilderModerationRevision(username)).toBe(0)
    const unchangedId = await appendAdminActionReceipt({
      actorUserId: firstActorId,
      actorUsername: `${PREFIX}-first-admin`,
      requestId: `${PREFIX}-moderation-noop`,
      action: Permission.BLOCK_BUILDER,
      targetType: 'builder',
      targetId: username,
      requestHash: hashFor({
        requestId: `${PREFIX}-moderation-noop`,
        action: Permission.BLOCK_BUILDER,
        targetType: 'builder',
        targetId: username,
      }),
      outcome: 'unchanged',
      receipt: { blocked: true },
    })
    expect(unchangedId).toBeGreaterThan(0)
    expect(await getBuilderModerationRevision(username)).toBe(0)

    const blockId = await appendAdminActionReceipt({
      actorUserId: firstActorId,
      actorUsername: `${PREFIX}-first-admin`,
      requestId: `${PREFIX}-moderation-block`,
      action: Permission.BLOCK_BUILDER,
      targetType: 'builder',
      targetId: username,
      requestHash: hashFor({
        requestId: `${PREFIX}-moderation-block`,
        action: Permission.BLOCK_BUILDER,
        targetType: 'builder',
        targetId: username,
      }),
      outcome: 'applied',
      receipt: { blocked: true },
    })
    expect(await getBuilderModerationRevision(username)).toBe(blockId)

    const reactivateId = await appendAdminActionReceipt({
      actorUserId: firstActorId,
      actorUsername: `${PREFIX}-first-admin`,
      requestId: `${PREFIX}-moderation-reactivate`,
      action: Permission.REACTIVATE_BUILDER,
      targetType: 'builder',
      targetId: username,
      requestHash: hashFor({
        requestId: `${PREFIX}-moderation-reactivate`,
        action: Permission.REACTIVATE_BUILDER,
        targetType: 'builder',
        targetId: username,
      }),
      outcome: 'applied',
      receipt: { blocked: false },
    })
    expect(await getBuilderModerationRevision(username)).toBe(reactivateId)
  })

  it('rolls a receipt back with the surrounding domain transaction', async () => {
    const requestId = `${PREFIX}-rolled-back`
    await expect(
      withTransaction(async () => {
        await appendAdminActionReceipt({
          actorUserId: firstActorId,
          actorUsername: `${PREFIX}-first-admin`,
          requestId,
          action: Permission.ADJUST_CREDITS,
          targetType: 'credits',
          targetId: `${PREFIX}-builder`,
          requestHash: hashFor({ requestId }),
          outcome: 'applied',
          receipt: { available_amount: 7 },
        })
        throw new Error('force transaction rollback')
      })
    ).rejects.toThrow('force transaction rollback')
    expect(
      await findAdminActionReceipt({ actorUserId: firstActorId, requestId })
    ).toBeNull()
  })
})
