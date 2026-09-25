import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdminSession } from '@/types/auth'
import { UserRole } from './roles'
import { createClaimIntent, CLAIM_INTENT_TTL_MS } from './credits/claim-service'
import { db, initializeDatabase, insertAdminUser } from './database'
import {
  adjustBuilderCredits,
  AdminMutationError,
  parseAdminCreditAdjustmentInput,
} from './admin-mutations'

const PREFIX = `cr${Date.now().toString(36).slice(-6)}`
let actorUserId = ''
let actorSession: AdminSession
const actorUsername = `t${Date.now().toString(36).slice(-6)}`

function builderUsername(suffix: string): string {
  return `${PREFIX}${suffix}`
}

function parseInput(
  username: string,
  requestId: string,
  body: {
    readonly expected_revision: number
    readonly reason?: string
    readonly pending_amount?: number
    readonly available_amount?: number
  }
) {
  const parsed = parseAdminCreditAdjustmentInput(username, {
    ...body,
    request_id: requestId,
    reason: body.reason ?? 'corrección de soporte',
  })
  if (!parsed.ok) throw new Error(parsed.message)
  return parsed.input
}

async function seedCredits(
  username: string,
  pendingAmount = 10,
  availableAmount = 3
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO Credits
      (hive_username, pending_amount, available_amount, total_issued, total_consumed)
      VALUES (?, ?, ?, ?, 0)`,
    args: [
      username,
      pendingAmount,
      availableAmount,
      pendingAmount + availableAmount,
    ],
  })
}

async function readCredits(username: string) {
  const result = await db.execute({
    sql: `SELECT pending_amount, available_amount, revision
      FROM Credits WHERE hive_username = ?`,
    args: [username],
  })
  return result.rows[0]
}

async function expectMutationError(
  operation: Promise<unknown>,
  code: AdminMutationError['code']
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    code,
    name: 'AdminMutationError',
  })
}

describe('contextual administrative credit adjustments', () => {
  beforeAll(async () => {
    expect(await initializeDatabase()).toBe(true)
    actorUserId = await insertAdminUser({
      username: actorUsername,
      passwordHash: 'test-password-hash',
    })
    actorSession = {
      userId: actorUserId,
      username: actorUsername,
      role: UserRole.Admin,
      loginTime: Date.now(),
    }
  })

  afterAll(async () => {
    await db.execute({
      sql: 'DELETE FROM CreditClaimIntents WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
    await db.execute({
      sql: 'DELETE FROM CreditAudit WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
    await db.execute({
      sql: 'DELETE FROM AdminActionLog WHERE actor_user_id = ? OR target_id LIKE ?',
      args: [actorUserId, `${PREFIX}%`],
    })
    await db.execute({
      sql: 'DELETE FROM Credits WHERE hive_username LIKE ?',
      args: [`${PREFIX}%`],
    })
    await db.execute({
      sql: 'UPDATE "user" SET is_active = 1 WHERE id = ?',
      args: [actorUserId],
    })
    await db.execute({
      sql: 'DELETE FROM "user" WHERE id = ?',
      args: [actorUserId],
    })
  })

  it('rejects missing reasons, unchanged forms, decimals, and unknown fields', () => {
    expect(
      parseAdminCreditAdjustmentInput(builderUsername('a1'), {
        pending_amount: 5,
        expected_revision: 0,
        request_id: 'request-1',
        reason: '  ',
      })
    ).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(
      parseAdminCreditAdjustmentInput(builderUsername('a2'), {
        expected_revision: 0,
        request_id: 'request-2',
        reason: 'valid reason',
      })
    ).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(
      parseAdminCreditAdjustmentInput(builderUsername('a3'), {
        pending_amount: 4.5,
        expected_revision: 0,
        request_id: 'request-3',
        reason: 'valid reason',
      })
    ).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
    expect(
      parseAdminCreditAdjustmentInput(builderUsername('a4'), {
        available_amount: 5,
        expected_revision: 0,
        request_id: 'request-4',
        reason: 'valid reason',
        actor: actorUsername,
      })
    ).toMatchObject({ ok: false, code: 'INVALID_COMMAND' })
  })

  it('denies pending reductions during an active claim and allows increases and available adjustments', async () => {
    const username = builderUsername('c1')
    await seedCredits(username)
    const claim = await createClaimIntent(username, {
      now: Date.now(),
      hashFactory: () => 'a'.repeat(64),
    })
    expect(claim.ok).toBe(true)

    await expectMutationError(
      adjustBuilderCredits(
        actorSession,
        parseInput(username, 'active-reduction', {
          expected_revision: 0,
          pending_amount: 9,
        })
      ),
      'PENDING_CLAIM_ACTIVE'
    )
    expect(await readCredits(username)).toMatchObject({
      pending_amount: 10,
      available_amount: 3,
      revision: 0,
    })

    const increased = await adjustBuilderCredits(
      actorSession,
      parseInput(username, 'active-increase', {
        expected_revision: 0,
        pending_amount: 11,
      })
    )
    expect(increased).toMatchObject({
      disposition: 'applied',
      credits: { pending_amount: 11, available_amount: 3, revision: 1 },
    })

    const availableAdjustment = await adjustBuilderCredits(
      actorSession,
      parseInput(username, 'active-available', {
        expected_revision: 1,
        available_amount: 8,
      })
    )
    expect(availableAdjustment.credits).toMatchObject({
      pending_amount: 11,
      available_amount: 8,
      revision: 2,
    })
  })

  it('allows a reduction when the only claim intent is expired', async () => {
    const username = builderUsername('c2')
    await seedCredits(username)
    const now = Date.now() - CLAIM_INTENT_TTL_MS * 2
    const claim = await createClaimIntent(username, {
      now,
      hashFactory: () => 'b'.repeat(64),
    })
    expect(claim.ok).toBe(true)

    const result = await adjustBuilderCredits(
      actorSession,
      parseInput(username, 'expired-reduction', {
        expected_revision: 0,
        pending_amount: 4,
      })
    )
    expect(result.credits).toMatchObject({
      pending_amount: 4,
      available_amount: 3,
      revision: 1,
    })
  })

  it('rejects stale revisions even when the balance has returned to its old value', async () => {
    const username = builderUsername('c3')
    await seedCredits(username)
    await adjustBuilderCredits(
      actorSession,
      parseInput(username, 'aba-first', {
        expected_revision: 0,
        pending_amount: 4,
      })
    )
    await adjustBuilderCredits(
      actorSession,
      parseInput(username, 'aba-second', {
        expected_revision: 1,
        pending_amount: 10,
      })
    )

    await expectMutationError(
      adjustBuilderCredits(
        actorSession,
        parseInput(username, 'aba-stale-form', {
          expected_revision: 0,
          pending_amount: 8,
        })
      ),
      'STALE_CREDIT_REVISION'
    )
    expect(await readCredits(username)).toMatchObject({
      pending_amount: 10,
      available_amount: 3,
      revision: 2,
    })
  })

  it('replays a committed adjustment without repeating its credit audit', async () => {
    const username = builderUsername('c4')
    await seedCredits(username)
    const command = parseInput(username, 'replay-command', {
      expected_revision: 0,
      pending_amount: 6,
      available_amount: 5,
    })
    const first = await adjustBuilderCredits(actorSession, command)
    const replay = await adjustBuilderCredits(actorSession, command)
    expect(first.disposition).toBe('applied')
    expect(replay).toMatchObject({
      disposition: 'replayed',
      actionLogId: first.actionLogId,
      credits: first.credits,
    })
    expect(await readCredits(username)).toMatchObject({
      pending_amount: 6,
      available_amount: 5,
      revision: 1,
    })
    const audit = await db.execute({
      sql: 'SELECT operation FROM CreditAudit WHERE hive_username = ?',
      args: [username],
    })
    expect(audit.rows).toHaveLength(2)
  })

  it('refuses request-ID reuse with different command content', async () => {
    const username = builderUsername('c5')
    await seedCredits(username)
    await adjustBuilderCredits(
      actorSession,
      parseInput(username, 'same-request-id', {
        expected_revision: 0,
        pending_amount: 8,
      })
    )
    await expectMutationError(
      adjustBuilderCredits(
        actorSession,
        parseInput(username, 'same-request-id', {
          expected_revision: 0,
          pending_amount: 7,
        })
      ),
      'IDEMPOTENCY_CONFLICT'
    )
  })

  it('returns not-found and refuses a now-inactive admin actor', async () => {
    const missingUsername = builderUsername('c6')
    await expectMutationError(
      adjustBuilderCredits(
        actorSession,
        parseInput(missingUsername, 'missing-builder', {
          expected_revision: 0,
          available_amount: 3,
        })
      ),
      'RESOURCE_NOT_FOUND'
    )

    const username = builderUsername('c7')
    await seedCredits(username)
    await db.execute({
      sql: 'UPDATE "user" SET is_active = 0 WHERE id = ?',
      args: [actorUserId],
    })
    try {
      await expectMutationError(
        adjustBuilderCredits(
          actorSession,
          parseInput(username, 'inactive-actor', {
            expected_revision: 0,
            pending_amount: 9,
          })
        ),
        'UNAUTHENTICATED'
      )
    } finally {
      await db.execute({
        sql: 'UPDATE "user" SET is_active = 1 WHERE id = ?',
        args: [actorUserId],
      })
    }
    expect(await readCredits(username)).toMatchObject({
      pending_amount: 10,
      revision: 0,
    })
  })

  it('rolls back the balance and domain audit if receipt persistence fails', async () => {
    const username = builderUsername('c8')
    await seedCredits(username)
    await db.execute(`CREATE TRIGGER fail_admin_action_receipt
      BEFORE INSERT ON AdminActionLog
      BEGIN SELECT RAISE(ABORT, 'receipt insert failed'); END`)
    try {
      await expect(
        adjustBuilderCredits(
          actorSession,
          parseInput(username, 'receipt-failure', {
            expected_revision: 0,
            pending_amount: 4,
          })
        )
      ).rejects.toThrow('receipt insert failed')
    } finally {
      await db.execute('DROP TRIGGER IF EXISTS fail_admin_action_receipt')
    }
    expect(await readCredits(username)).toMatchObject({
      pending_amount: 10,
      available_amount: 3,
      revision: 0,
    })
    const audit = await db.execute({
      sql: 'SELECT id FROM CreditAudit WHERE hive_username = ?',
      args: [username],
    })
    expect(audit.rows).toHaveLength(0)
  })

  it('records a reason-bearing no-op without incrementing the revision', async () => {
    const username = builderUsername('c9')
    await seedCredits(username)
    const result = await adjustBuilderCredits(
      actorSession,
      parseInput(username, 'no-op', {
        expected_revision: 0,
        pending_amount: 10,
      })
    )
    expect(result).toMatchObject({
      disposition: 'unchanged',
      credits: { pending_amount: 10, available_amount: 3, revision: 0 },
    })
    expect(await readCredits(username)).toMatchObject({ revision: 0 })
    const actionLog = await db.execute({
      sql: 'SELECT outcome, reason FROM AdminActionLog WHERE id = ?',
      args: [result.actionLogId],
    })
    expect(actionLog.rows).toEqual([
      { outcome: 'unchanged', reason: 'corrección de soporte' },
    ])
  })
})
