import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, db } from '@/lib/database'
import { hiveAuthEmail } from '@/lib/auth-user'
import {
  blockchainStatusFromTransaction,
  accountExistsInDB,
  confirmCompletedAttemptAccount,
  completeAccountCreationInDB as completePersistedAttempt,
  enqueueReconciliation,
  getAccountCreationState,
  getPendingReconciliations,
  reserveTicketCredit,
  rollbackTicketReservation as rollbackPersistedAttempt,
} from '@/utils/db-ticket-validator'
import {
  claimCreationAttempt,
  findOpenCreationAttempt,
  getCreationAttempt,
  markAttemptBroadcasting as markPersistedAttemptBroadcasting,
  persistAttemptBroadcastOutcome as persistAttemptBroadcastOutcomeWithLease,
  persistAttemptPreparation as persistAttemptPreparationWithLease,
  type CreationAttemptLease,
} from '@/lib/creation-attempts'
import type { HiveCreationEvidenceProvider } from '@/lib/creation-evidence'
import { reconcileCreationAttempt } from '@/lib/creation-reconciler'
import { claimAccountRcDelegation } from '@/lib/create/queue-rc-delegation'
import { creationFlagsFromPersistedAccount } from '@/lib/account-status'
import { BLOCKCHAIN_STATUS, HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'
import type { HiveTransactionResult } from '@/types/hive-transaction'
import type { CreationAttemptKeys } from '@/lib/creation-attempts'
import type { PreparedAttemptSnapshot } from '@/lib/creation-attempts'

const RUN = crypto.randomUUID().replace(/-/g, '')
const TICKET = `SIMT${RUN.slice(0, 12).toUpperCase()}`
const BUILDER_ID = crypto.randomUUID()
const BUILDER_USERNAME = `simb${RUN.slice(0, 10)}`
const BUILDER_EMAIL = hiveAuthEmail(BUILDER_USERNAME)

async function currentTestLease(
  correlationId: string
): Promise<CreationAttemptLease | null> {
  const attempt = await getCreationAttempt(correlationId)
  if (!attempt) return null
  if (attempt.leaseToken) {
    return {
      correlationId,
      token: attempt.leaseToken,
      version: attempt.version,
      generation: attempt.leaseGeneration,
    }
  }
  return claimCreationAttempt(correlationId)
}

async function completeAccountCreationInDB(
  correlationId: string,
  tx?: HiveTransactionResult,
  options?: { readonly hiveMatched?: boolean }
) {
  const attempt = await getCreationAttempt(correlationId)
  const lease =
    attempt?.status === 'completed' || attempt?.status === 'rolled_back'
      ? undefined
      : await currentTestLease(correlationId)
  return completePersistedAttempt(
    correlationId,
    tx,
    options,
    lease ?? undefined
  )
}

async function rollbackTicketReservation(correlationId: string) {
  const attempt = await getCreationAttempt(correlationId)
  const lease =
    attempt?.status === 'completed' || attempt?.status === 'rolled_back'
      ? undefined
      : await currentTestLease(correlationId)
  return rollbackPersistedAttempt(correlationId, lease ?? undefined)
}

async function persistAttemptPreparation(
  correlationId: string,
  snapshot: PreparedAttemptSnapshot
) {
  const lease = await claimCreationAttempt(correlationId)
  if (!lease) return null
  return persistAttemptPreparationWithLease(lease, snapshot)
}

async function markAttemptBroadcasting(
  correlationId: string
): Promise<boolean> {
  const lease = await currentTestLease(correlationId)
  if (!lease) return false
  return (await markPersistedAttemptBroadcasting(lease)) !== null
}

function keysFor(username: string): CreationAttemptKeys {
  return {
    ownerPublicKey: `STM7owner${username}`,
    activePublicKey: `STM7active${username}`,
    postingPublicKey: `STM7posting${username}`,
    memoPublicKey: `STM7memo${username}`,
  }
}

function simulatedTx(id: string): HiveTransactionResult {
  return {
    id,
    mode: HIVE_TX_MODE_VALUES.SIMULATE,
    broadcasted: false,
    wax: {
      validated: true,
      onChainVerified: true,
      signed: true,
      authorityVerified: true,
    },
    requiredAuthorities: {},
    signaturePublicKeys: ['STM7public'],
  }
}

function reserveInput(
  correlationId: string,
  username: string,
  executionMode: (typeof HIVE_TX_MODE_VALUES)[keyof typeof HIVE_TX_MODE_VALUES] = HIVE_TX_MODE_VALUES.SIMULATE
) {
  return {
    ticketCode: TICKET,
    correlationId,
    username,
    keys: keysFor(username),
    executionMode,
  }
}

async function createBroadcastingAttempt(
  correlationId: string,
  username: string,
  expiration: string
): Promise<CreationAttemptLease> {
  const reserved = await reserveTicketCredit(
    reserveInput(correlationId, username, HIVE_TX_MODE_VALUES.BROADCAST)
  )
  if (!reserved.success) throw new Error(reserved.error ?? 'Reservation failed')
  const claimed = await claimCreationAttempt(correlationId)
  if (!claimed) throw new Error('Attempt claim failed')
  const prepared = await persistAttemptPreparationWithLease(claimed, {
    id: 'b'.repeat(40),
    expiration,
    wax: {
      validated: true,
      onChainVerified: true,
      signed: true,
      authorityVerified: true,
    },
  })
  if (!prepared) throw new Error('Preparation persistence failed')
  const broadcasting = await markPersistedAttemptBroadcasting(prepared)
  if (!broadcasting) throw new Error('Broadcast transition failed')
  return broadcasting
}

function includedCreationTransaction(username: string) {
  const expected = keysFor(username)
  const authority = (key: string) => ({
    weight_threshold: 1,
    account_auths: [],
    key_auths: [[key, 1]],
  })
  return {
    transaction_id: 'b'.repeat(40),
    operations: [
      {
        type: 'create_claimed_account_operation',
        value: {
          new_account_name: username,
          owner: authority(expected.ownerPublicKey),
          active: authority(expected.activePublicKey),
          posting: authority(expected.postingPublicKey),
          memo_key: expected.memoPublicKey,
        },
      },
    ],
  }
}

async function cleanupFixture(): Promise<void> {
  await db.execute({
    sql: `DELETE FROM Notifications WHERE hive_username = ?`,
    args: [BUILDER_USERNAME],
  })
  await db.execute({
    sql: `DELETE FROM CreditAudit WHERE hive_username = ?`,
    args: [BUILDER_ID],
  })
  await db.execute({
    sql: `DELETE FROM CreationAttemptEvents WHERE ticket_id IN (SELECT id FROM Tickets WHERE code = ?)`,
    args: [TICKET],
  })
  await db.execute({
    sql: `DELETE FROM CreationAttempts WHERE ticket = ?`,
    args: [TICKET],
  })
  await db.execute({
    sql: `DELETE FROM Accounts WHERE ticket = ?`,
    args: [TICKET],
  })
  await db.execute({
    sql: `DELETE FROM Tickets WHERE code = ?`,
    args: [TICKET],
  })
  await db.execute({
    sql: `DELETE FROM Credits WHERE hive_username = ?`,
    args: [BUILDER_USERNAME],
  })
}

beforeAll(async () => {
  const ok = await initializeDatabase()
  expect(ok).toBe(true)
  await cleanupFixture()
  await db.execute({
    sql: `INSERT INTO Credits (hive_username, pending_amount, available_amount, total_issued, total_consumed)
			VALUES (?, 0, 10, 10, 0)`,
    args: [BUILDER_USERNAME],
  })
  await db.execute({
    sql: `INSERT INTO Tickets (
      code, description, total_uses, remaining_uses, creator_username,
      funding_source, owner_builder_username
    ) VALUES (?, 'sim', 3, 3, ?, 'builder_credits', ?)`,
    args: [TICKET, BUILDER_USERNAME, BUILDER_USERNAME],
  })
})

afterAll(async () => {
  await cleanupFixture()
})

describe('simulation DB completion', () => {
  it('T01 consumes ticket and stores simulated account', async () => {
    const username = `simu${Date.now().toString(36)}`
    const reserved = await reserveTicketCredit(reserveInput('corr-1', username))
    expect(reserved.success).toBe(true)

    const completed = await completeAccountCreationInDB(
      'corr-1',
      simulatedTx('tx-sim-1')
    )
    expect(completed.success).toBe(true)

    const account = await db.execute({
      sql: `SELECT execution_mode, blockchain_status, wax_status, transaction_id FROM Accounts WHERE username = ?`,
      args: [username],
    })
    expect(account.rows[0]?.execution_mode).toBe('simulate')
    expect(account.rows[0]?.blockchain_status).toBe('simulated')
    expect(account.rows[0]?.wax_status).toBe('passed')
    expect(account.rows[0]?.transaction_id).toBe('tx-sim-1')

    const ticket = await db.execute({
      sql: `SELECT remaining_uses FROM Tickets WHERE code = ?`,
      args: [TICKET],
    })
    expect(Number(ticket.rows[0]?.remaining_uses)).toBe(2)

    const events = await db.execute({
      sql: `SELECT event_type FROM CreationAttemptEvents
            WHERE correlation_id = ? ORDER BY id`,
      args: ['corr-1'],
    })
    expect(events.rows.map(row => row.event_type)).toEqual([
      'reserved',
      'completed',
    ])
    const creditConsumption = await db.execute({
      sql: `SELECT hive_username, amount FROM CreditAudit
            WHERE external_reference = ?`,
      args: ['creation:corr-1:consume'],
    })
    expect(creditConsumption.rows).toMatchObject([
      { hive_username: BUILDER_USERNAME, amount: -1 },
    ])
  })

  it('broadcasted tx is stored as broadcasted, not confirmed', async () => {
    const liveTx: HiveTransactionResult = {
      ...simulatedTx('tx-live-1'),
      mode: HIVE_TX_MODE_VALUES.BROADCAST,
      broadcasted: true,
    }
    expect(blockchainStatusFromTransaction(liveTx)).toBe(
      BLOCKCHAIN_STATUS.BROADCASTED
    )

    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `liveu${Date.now().toString(36)}`
    const reserved = await reserveTicketCredit(
      reserveInput('corr-live', username, HIVE_TX_MODE_VALUES.BROADCAST)
    )
    expect(reserved.success).toBe(true)
    expect((await getCreationAttempt('corr-live'))?.executionMode).toBe(
      HIVE_TX_MODE_VALUES.BROADCAST
    )
    const completed = await completeAccountCreationInDB('corr-live', liveTx)
    expect(completed.success).toBe(true)
    const persisted = await getAccountCreationState(username)
    expect(persisted?.executionMode).toBe(HIVE_TX_MODE_VALUES.BROADCAST)
    expect(persisted?.blockchainStatus).toBe(BLOCKCHAIN_STATUS.BROADCASTED)
    expect(persisted?.transactionId).toBe('tx-live-1')
  })

  it('T07 concurrent reservation consumes one credit', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 1 WHERE code = ?`,
      args: [TICKET],
    })
    const [first, second] = await Promise.all([
      reserveTicketCredit(
        reserveInput('corr-a', `cona${Date.now().toString(36)}`)
      ),
      reserveTicketCredit(
        reserveInput('corr-b', `conb${Date.now().toString(36)}`)
      ),
    ])
    const successes = [first, second].filter(result => result.success)
    expect(successes).toHaveLength(1)
    const failed = [first, second].find(result => !result.success)
    if (failed?.correlationId) {
      await rollbackTicketReservation(failed.correlationId)
    }
    const winner = successes[0]
    if (winner?.correlationId) {
      await rollbackTicketReservation(winner.correlationId)
    }
  })

  it('T06 simulation DB failure rolls back ticket and skips reconciliation', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `failu${Date.now().toString(36)}`
    await reserveTicketCredit(reserveInput('corr-fail', username))
    const completed = await completeAccountCreationInDB('corr-fail', {
      ...simulatedTx('tx-fail'),
      mode: HIVE_TX_MODE_VALUES.BROADCAST,
      broadcasted: true,
    })
    expect(completed.success).toBe(false)
    expect(await getCreationAttempt('corr-fail')).toMatchObject({
      status: 'reserved',
    })
    await rollbackTicketReservation('corr-fail')
    await enqueueReconciliation({
      correlationId: 'corr-fail',
      username: 'nobody',
      ticketCode: TICKET,
      reason: 'db_completion_failed',
    })
    const pending = await getPendingReconciliations()
    expect(
      pending.filter(entry => entry.correlationId === 'corr-fail')
    ).toHaveLength(0)
  })

  it('rolls back the terminal event when account insertion fails', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const correlationId = 'corr-terminal-audit-failure'
    const username = `audf${Date.now().toString(36)}`
    const reserved = await reserveTicketCredit(
      reserveInput(correlationId, username)
    )
    expect(reserved.success).toBe(true)
    const triggerName = `fail_account_${RUN.slice(0, 16)}`
    await db.execute({
      sql: `CREATE TRIGGER ${triggerName} BEFORE INSERT ON Accounts
            WHEN NEW.correlation_id = '${correlationId}'
            BEGIN SELECT RAISE(ABORT, 'forced account insert failure'); END`,
      args: [],
    })

    try {
      expect(
        (
          await completeAccountCreationInDB(
            correlationId,
            simulatedTx('tx-terminal-audit-failure')
          )
        ).success
      ).toBe(false)
      expect(await getCreationAttempt(correlationId)).toMatchObject({
        status: 'reserved',
      })
      const terminalEvents = await db.execute({
        sql: `SELECT COUNT(*) AS count FROM CreationAttemptEvents
              WHERE correlation_id = ? AND event_type = 'completed'`,
        args: [correlationId],
      })
      expect(Number(terminalEvents.rows[0]?.count)).toBe(0)
    } finally {
      await db.execute({
        sql: `DROP TRIGGER IF EXISTS ${triggerName}`,
        args: [],
      })
      await rollbackTicketReservation(correlationId)
    }
  })

  it('pipeline failure rolls the reserved ticket credit back', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `waxu${Date.now().toString(36)}`
    const reserved = await reserveTicketCredit(
      reserveInput('corr-wax', username)
    )
    expect(reserved.success).toBe(true)
    const mid = await db.execute({
      sql: `SELECT remaining_uses FROM Tickets WHERE code = ?`,
      args: [TICKET],
    })
    expect(Number(mid.rows[0]?.remaining_uses)).toBe(2)
    const rolled = await rollbackTicketReservation('corr-wax')
    expect(rolled.success).toBe(true)
    const after = await db.execute({
      sql: `SELECT remaining_uses FROM Tickets WHERE code = ?`,
      args: [TICKET],
    })
    expect(Number(after.rows[0]?.remaining_uses)).toBe(3)
    expect(await getCreationAttempt('corr-wax')).toMatchObject({
      status: 'rolled_back',
    })
  })

  it('completion replay returns the original result without a second credit consumption', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `dupu${Date.now().toString(36)}`
    expect(
      (await reserveTicketCredit(reserveInput('corr-dup-1', username))).success
    ).toBe(true)
    const first = await completeAccountCreationInDB(
      'corr-dup-1',
      simulatedTx('tx-dup-1')
    )
    expect(first.success).toBe(true)
    const replay = await completeAccountCreationInDB(
      'corr-dup-1',
      simulatedTx('tx-dup-1')
    )
    expect(replay.success).toBe(true)
    expect(
      (
        await completeAccountCreationInDB(
          'corr-dup-1',
          simulatedTx('tx-dup-other')
        )
      ).success
    ).toBe(false)
    expect((await rollbackTicketReservation('corr-dup-1')).success).toBe(false)

    const accounts = await db.execute({
      sql: 'SELECT COUNT(*) AS count FROM Accounts WHERE correlation_id = ?',
      args: ['corr-dup-1'],
    })
    expect(Number(accounts.rows[0]?.count)).toBe(1)
    const credits = await db.execute({
      sql: 'SELECT total_consumed FROM Credits WHERE hive_username = ?',
      args: [BUILDER_USERNAME],
    })
    expect(Number(credits.rows[0]?.total_consumed)).toBeGreaterThan(0)

    const ticket = await db.execute({
      sql: `SELECT remaining_uses FROM Tickets WHERE code = ?`,
      args: [TICKET],
    })
    expect(Number(ticket.rows[0]?.remaining_uses)).toBe(2)
  })

  it('completion and rollback race produce exactly one terminal result', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `race${Date.now().toString(36)}`
    expect(
      (await reserveTicketCredit(reserveInput('corr-race', username))).success
    ).toBe(true)

    const [completed, rolledBack] = await Promise.all([
      completeAccountCreationInDB('corr-race', simulatedTx('tx-race')),
      rollbackTicketReservation('corr-race'),
    ])
    expect(
      [completed.success, rolledBack.success].filter(Boolean)
    ).toHaveLength(1)

    const attempt = await getCreationAttempt('corr-race')
    const account = await db.execute({
      sql: 'SELECT COUNT(*) AS count FROM Accounts WHERE correlation_id = ?',
      args: ['corr-race'],
    })
    const ticket = await db.execute({
      sql: 'SELECT remaining_uses FROM Tickets WHERE code = ?',
      args: [TICKET],
    })
    const terminalEvents = await db.execute({
      sql: `SELECT event_type, to_status FROM CreationAttemptEvents
            WHERE correlation_id = ? AND event_type IN ('completed', 'rolled_back')`,
      args: ['corr-race'],
    })
    expect(terminalEvents.rows).toHaveLength(1)
    if (attempt?.status === 'completed') {
      expect(completed.success).toBe(true)
      expect(rolledBack.success).toBe(false)
      expect(Number(account.rows[0]?.count)).toBe(1)
      expect(Number(ticket.rows[0]?.remaining_uses)).toBe(2)
      expect(terminalEvents.rows[0]).toMatchObject({
        event_type: 'completed',
        to_status: 'completed',
      })
    } else {
      expect(attempt?.status).toBe('rolled_back')
      expect(completed.success).toBe(false)
      expect(rolledBack.success).toBe(true)
      expect(Number(account.rows[0]?.count)).toBe(0)
      expect(Number(ticket.rows[0]?.remaining_uses)).toBe(3)
      expect(terminalEvents.rows[0]).toMatchObject({
        event_type: 'rolled_back',
        to_status: 'rolled_back',
      })
    }
  })

  it('a late completion cannot reverse a prior rollback', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `late${Date.now().toString(36)}`
    expect(
      (await reserveTicketCredit(reserveInput('corr-late', username))).success
    ).toBe(true)
    expect((await rollbackTicketReservation('corr-late')).success).toBe(true)

    const lateCompletion = await completeAccountCreationInDB(
      'corr-late',
      simulatedTx('tx-late')
    )
    expect(lateCompletion.success).toBe(false)
    expect(await getCreationAttempt('corr-late')).toMatchObject({
      status: 'rolled_back',
    })
    expect(await accountExistsInDB(username)).toBe(false)
    const ticket = await db.execute({
      sql: 'SELECT remaining_uses FROM Tickets WHERE code = ?',
      args: [TICKET],
    })
    expect(Number(ticket.rows[0]?.remaining_uses)).toBe(3)
  })

  it('Hive confirmation upgrades broadcasted to confirmed from persisted state', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `confu${Date.now().toString(36)}`
    expect(
      (
        await reserveTicketCredit(
          reserveInput('corr-conf', username, HIVE_TX_MODE_VALUES.BROADCAST)
        )
      ).success
    ).toBe(true)
    const liveTx: HiveTransactionResult = {
      ...simulatedTx('tx-conf-1'),
      mode: HIVE_TX_MODE_VALUES.BROADCAST,
      broadcasted: true,
    }
    expect(
      (await completeAccountCreationInDB('corr-conf', liveTx)).success
    ).toBe(true)
    expect((await getAccountCreationState(username))?.blockchainStatus).toBe(
      BLOCKCHAIN_STATUS.BROADCASTED
    )

    expect(await confirmCompletedAttemptAccount('corr-conf')).toBe(true)
    const persisted = await getAccountCreationState(username)
    expect(persisted?.blockchainStatus).toBe(BLOCKCHAIN_STATUS.CONFIRMED)
    const flags = creationFlagsFromPersistedAccount(persisted!)
    expect(flags.broadcasted).toBe(true)
    expect(flags.chainConfirmed).toBe(true)
    expect(flags.executionMode).toBe(HIVE_TX_MODE_VALUES.BROADCAST)
    expect(await claimAccountRcDelegation(username)).toMatchObject({
      username,
      generation: 1,
    })
    expect(await claimAccountRcDelegation(username)).toBeNull()
  })

  it('Hive-matched recovery persists confirmed even if broadcasted was never saved', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `hivm${Date.now().toString(36)}`
    expect(
      (
        await reserveTicketCredit(
          reserveInput(
            'corr-hive-match',
            username,
            HIVE_TX_MODE_VALUES.BROADCAST
          )
        )
      ).success
    ).toBe(true)
    await persistAttemptPreparation('corr-hive-match', {
      id: 'tx-timeout-1',
      expiration: '2030-01-01T00:00:00',
      wax: {
        validated: true,
        onChainVerified: true,
        signed: true,
        authorityVerified: true,
      },
    })
    const completed = await completeAccountCreationInDB(
      'corr-hive-match',
      {
        ...simulatedTx('tx-timeout-1'),
        mode: HIVE_TX_MODE_VALUES.BROADCAST,
        broadcasted: false,
      },
      { hiveMatched: true }
    )
    expect(completed.success).toBe(true)
    const persisted = await getAccountCreationState(username)
    expect(persisted?.blockchainStatus).toBe(BLOCKCHAIN_STATUS.CONFIRMED)
    expect(persisted?.transactionId).toBe('tx-timeout-1')
  })

  it('rolls back a stale reserved attempt so a later reserve can proceed', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `stal${Date.now().toString(36)}`
    expect(
      (await reserveTicketCredit(reserveInput('corr-stale', username))).success
    ).toBe(true)
    await db.execute({
      sql: `UPDATE CreationAttempts SET updated_at = datetime('now', '-10 minutes') WHERE correlation_id = ?`,
      args: ['corr-stale'],
    })
    const { recoverStaleCreationAttempts } = await import(
      '@/lib/confirm-broadcasted'
    )
    expect(await recoverStaleCreationAttempts()).toBeGreaterThan(0)
    expect(await getCreationAttempt('corr-stale')).toMatchObject({
      status: 'rolled_back',
    })
    expect(
      (await reserveTicketCredit(reserveInput('corr-stale-2', username)))
        .success
    ).toBe(true)
    await rollbackTicketReservation('corr-stale-2')
  })

  it('ties a reserved credit to this username and keys, not the ticket counter', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3, total_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const firstUser = `resu${Date.now().toString(36)}`
    const laterUser = `resl${Date.now().toString(36)}`
    expect(
      await findOpenCreationAttempt({
        username: laterUser,
        ticket: TICKET,
        keys: keysFor(laterUser),
      })
    ).toBeNull()

    expect(
      (await reserveTicketCredit(reserveInput('corr-reserved', firstUser)))
        .success
    ).toBe(true)
    expect(
      await findOpenCreationAttempt({
        username: firstUser,
        ticket: TICKET,
        keys: keysFor(firstUser),
      })
    ).not.toBeNull()
    expect(
      await findOpenCreationAttempt({
        username: laterUser,
        ticket: TICKET,
        keys: keysFor(laterUser),
      })
    ).toBeNull()

    await persistAttemptPreparation('corr-reserved', {
      id: 'prepared-tx-1',
      expiration: '2030-01-01T00:00:00',
      wax: {
        validated: true,
        onChainVerified: true,
        signed: true,
        authorityVerified: true,
      },
    })
    const attempt = await getCreationAttempt('corr-reserved')
    expect(attempt?.transactionId).toBe('prepared-tx-1')
    await rollbackTicketReservation('corr-reserved')
  })

  it('refuses to mark broadcasting after the attempt lost ownership', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `casu${Date.now().toString(36)}`
    expect(
      (await reserveTicketCredit(reserveInput('corr-cas', username))).success
    ).toBe(true)
    await persistAttemptPreparation('corr-cas', {
      id: 'tx-cas-1',
      expiration: '2030-01-01T00:00:00',
      wax: {
        validated: true,
        onChainVerified: true,
        signed: true,
        authorityVerified: true,
      },
    })
    expect((await rollbackTicketReservation('corr-cas')).success).toBe(true)
    expect(await markAttemptBroadcasting('corr-cas')).toBe(false)
    expect(await getCreationAttempt('corr-cas')).toMatchObject({
      status: 'rolled_back',
    })
  })

  it('fences stale lease generations from preparation, completion, and rollback', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `lease${Date.now().toString(36)}`
    expect(
      (await reserveTicketCredit(reserveInput('corr-lease', username))).success
    ).toBe(true)

    const oldLease = await claimCreationAttempt('corr-lease')
    expect(oldLease).not.toBeNull()
    expect(await claimCreationAttempt('corr-lease')).toBeNull()

    await db.execute({
      sql: `UPDATE CreationAttempts
            SET lease_expires_at = datetime('now', '-1 second')
            WHERE correlation_id = ?`,
      args: ['corr-lease'],
    })
    const newLease = await claimCreationAttempt('corr-lease')
    expect(newLease).not.toBeNull()
    expect(newLease?.generation).toBe((oldLease?.generation ?? 0) + 1)
    expect(newLease?.version).toBeGreaterThan(oldLease?.version ?? 0)

    const snapshot = {
      id: 'tx-stale-lease',
      expiration: '2030-01-01T00:00:00',
      wax: {
        validated: true,
        onChainVerified: true,
        signed: true,
        authorityVerified: true,
      },
    }
    expect(
      await persistAttemptPreparationWithLease(oldLease!, snapshot)
    ).toBeNull()
    expect(
      (
        await completePersistedAttempt(
          'corr-lease',
          simulatedTx('tx-stale-lease'),
          undefined,
          oldLease!
        )
      ).success
    ).toBe(false)
    expect(
      (await rollbackPersistedAttempt('corr-lease', oldLease!)).success
    ).toBe(false)
    expect(
      (await rollbackPersistedAttempt('corr-lease', newLease!)).success
    ).toBe(true)

    const ticket = await db.execute({
      sql: 'SELECT remaining_uses FROM Tickets WHERE code = ?',
      args: [TICKET],
    })
    expect(Number(ticket.rows[0]?.remaining_uses)).toBe(3)
  })

  it('does not replace the prepared transaction identity when persisting an outcome', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `iden${Date.now().toString(36)}`
    expect(
      (await reserveTicketCredit(reserveInput('corr-immutable-txid', username)))
        .success
    ).toBe(true)
    const initialLease = await claimCreationAttempt('corr-immutable-txid')
    expect(initialLease).not.toBeNull()
    const preparedLease = await persistAttemptPreparationWithLease(
      initialLease!,
      {
        id: 'tx-original',
        expiration: '2030-01-01T00:00:00',
        wax: {
          validated: true,
          onChainVerified: true,
          signed: true,
          authorityVerified: true,
        },
      }
    )
    expect(preparedLease).not.toBeNull()
    expect(
      await persistAttemptBroadcastOutcomeWithLease(
        preparedLease!,
        simulatedTx('tx-substituted')
      )
    ).toBeNull()
    expect(await getCreationAttempt('corr-immutable-txid')).toMatchObject({
      status: 'prepared',
      transactionId: 'tx-original',
      version: preparedLease?.version,
    })
    expect(
      (await rollbackPersistedAttempt('corr-immutable-txid', preparedLease!))
        .success
    ).toBe(true)
  })

  it('only refunds a broadcast reservation after Hive proves irreversible expiration', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const correlationId = 'corr-expired-proof'
    const username = `exp${Date.now().toString(36)}`
    const firstLease = await createBroadcastingAttempt(
      correlationId,
      username,
      '2000-01-01T00:00:00'
    )
    expect(firstLease).not.toBeNull()
    await db.execute({
      sql: `UPDATE CreationAttempts
            SET lease_expires_at = datetime('now', '-1 second')
            WHERE correlation_id = ?`,
      args: [correlationId],
    })

    const provider: HiveCreationEvidenceProvider = {
      getStatus: vi.fn().mockResolvedValue({ status: 'expired_irreversible' }),
      getTransaction: vi.fn(),
    }
    const result = await reconcileCreationAttempt(correlationId, {
      evidenceProvider: provider,
    })
    expect(result.kind).toBe('rolled_back')
    expect(await getCreationAttempt(correlationId)).toMatchObject({
      status: 'rolled_back',
    })
    expect(provider.getStatus).toHaveBeenCalledWith({
      transactionId: 'b'.repeat(40),
      expiration: '2000-01-01T00:00:00',
    })
    expect(provider.getTransaction).not.toHaveBeenCalled()
    const ticket = await db.execute({
      sql: 'SELECT remaining_uses FROM Tickets WHERE code = ?',
      args: [TICKET],
    })
    expect(Number(ticket.rows[0]?.remaining_uses)).toBe(3)
  })

  it('completes from the exact create operation in an irreversible Hive transaction', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const correlationId = 'corr-included-proof'
    const username = `inc${Date.now().toString(36)}`
    await createBroadcastingAttempt(
      correlationId,
      username,
      '2030-01-01T00:00:00'
    )
    await db.execute({
      sql: `UPDATE CreationAttempts
            SET lease_expires_at = datetime('now', '-1 second')
            WHERE correlation_id = ?`,
      args: [correlationId],
    })
    const provider: HiveCreationEvidenceProvider = {
      getStatus: vi
        .fn()
        .mockResolvedValue({ status: 'within_irreversible_block' }),
      getTransaction: vi
        .fn()
        .mockResolvedValue(includedCreationTransaction(username)),
    }

    const result = await reconcileCreationAttempt(correlationId, {
      evidenceProvider: provider,
    })
    expect(result.kind).toBe('completed')
    expect(await getCreationAttempt(correlationId)).toMatchObject({
      status: 'completed',
    })
    expect(await getAccountCreationState(username)).toMatchObject({
      blockchainStatus: BLOCKCHAIN_STATUS.CONFIRMED,
      transactionId: 'b'.repeat(40),
    })
    expect(provider.getTransaction).toHaveBeenCalledWith('b'.repeat(40))
  })

  it('dry-run reconciliation inspects Hive without claiming or changing the attempt', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const correlationId = 'corr-dry-reconcile'
    const username = `dry${Date.now().toString(36)}`
    await createBroadcastingAttempt(
      correlationId,
      username,
      '2030-01-01T00:00:00'
    )
    const before = await getCreationAttempt(correlationId)
    expect(before).not.toBeNull()
    const provider: HiveCreationEvidenceProvider = {
      getStatus: vi
        .fn()
        .mockResolvedValue({ status: 'within_irreversible_block' }),
      getTransaction: vi
        .fn()
        .mockResolvedValue(includedCreationTransaction(username)),
    }

    expect(
      await reconcileCreationAttempt(correlationId, {
        dryRun: true,
        evidenceProvider: provider,
      })
    ).toMatchObject({ kind: 'would_complete' })
    const after = await getCreationAttempt(correlationId)
    expect(after?.version).toBe(before?.version)
    expect(after?.leaseToken).toBe(before?.leaseToken)
    expect(await accountExistsInDB(username)).toBe(false)
  })

  it('persists Hive-matched completion using the attempt identity', async () => {
    await db.execute({
      sql: `UPDATE Tickets SET remaining_uses = 3 WHERE code = ?`,
      args: [TICKET],
    })
    const username = `open${Date.now().toString(36)}`
    expect(
      (
        await reserveTicketCredit(
          reserveInput('corr-open', username, HIVE_TX_MODE_VALUES.BROADCAST)
        )
      ).success
    ).toBe(true)
    await persistAttemptPreparation('corr-open', {
      id: 'tx-open-1',
      expiration: '2030-01-01T00:00:00',
      wax: {
        validated: true,
        onChainVerified: true,
        signed: true,
        authorityVerified: true,
      },
    })
    expect(await markAttemptBroadcasting('corr-open')).toBe(true)
    const { persistHiveMatchedAccount } = await import(
      '@/lib/confirm-broadcasted'
    )
    const attempt = await getCreationAttempt('corr-open')
    expect(attempt).not.toBeNull()
    const lease = await currentTestLease('corr-open')
    expect(
      await persistHiveMatchedAccount(
        attempt!,
        {
          kind: 'created',
          transactionId: 'tx-open-1',
          operationIndex: 0,
        },
        lease ?? undefined
      )
    ).toBe(true)
    expect(await getCreationAttempt('corr-open')).toMatchObject({
      status: 'completed',
    })
    const account = await db.execute({
      sql: 'SELECT username, ticket_id FROM Accounts WHERE correlation_id = ?',
      args: ['corr-open'],
    })
    expect(account.rows[0]?.username).toBe(username)
    expect(Number(account.rows[0]?.ticket_id)).toBe(attempt?.ticketId)
  })
})
