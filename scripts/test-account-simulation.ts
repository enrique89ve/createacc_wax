import './test-setup-env.ts'
import { initializeDatabase, db } from '@/lib/database'
import { hiveAuthEmail } from '@/lib/auth-user'
import { RC_DELEGATION_AMOUNT } from '@/consts/constants'
import {
  BLOCKCHAIN_STATUS,
  CREATION_ATTEMPT_STATUS,
  HIVE_TX_MODE_VALUES,
} from '@/consts/hive-execution'
import {
  completeAccountCreationInDB,
  getPendingReconciliations,
  reserveTicketCredit,
  rollbackTicketReservation,
} from '@/utils/db-ticket-validator'
import {
  getCreationAttempt,
  persistAttemptBroadcastOutcome,
  persistAttemptPreparation,
} from '@/lib/creation-attempts'
import { HiveKeys } from '@/lib/create/get-keys'
import {
  createAccount,
  type ICreateAccountParams,
} from '@/lib/create/create-account'
import { simulateRcDelegation } from '@/lib/create/delegate-rc'
import { isBroadcastEnabled, isSimulationMode } from '@/lib/hive-execution-mode'
import {
  isRcSimulationSuccess,
  isSimulationSuccess,
  type HiveTransactionResult,
} from '@/types/hive-transaction'
import type { CreationAttemptKeys } from '@/lib/creation-attempts'

interface IsolationFixture {
  readonly ticket: string
  readonly username: string
  readonly builderId: string
  readonly builderUsername: string
  readonly builderEmail: string
  readonly correlationId: string
}

interface BatteryCase {
  readonly name: string
  readonly run: () => Promise<void>
}

function isolationIds(): IsolationFixture {
  const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  const builderUsername = `intb${suffix}`
  const username = `hhint${suffix}`
  return {
    ticket: `INTSIM${suffix.toUpperCase()}`,
    username,
    builderId: crypto.randomUUID(),
    builderUsername,
    builderEmail: hiveAuthEmail(builderUsername),
    correlationId: `corr-${username}`,
  }
}

function requireSimulationMode(): void {
  process.env.HIVE_TX_MODE = HIVE_TX_MODE_VALUES.SIMULATE
  if (!isSimulationMode() || isBroadcastEnabled()) {
    throw new Error(
      'Simulation battery refused to run outside HIVE_TX_MODE=simulate'
    )
  }
}

function keysFromParams(params: ICreateAccountParams): CreationAttemptKeys {
  return {
    ownerPublicKey: params.ownerPublicKey,
    activePublicKey: params.activePublicKey,
    postingPublicKey: params.postingPublicKey,
    memoPublicKey: params.memoPublicKey,
  }
}

function invalidCreateParams(username: string): ICreateAccountParams {
  return {
    username,
    ownerPublicKey: 'not-a-hive-key',
    activePublicKey: 'not-a-hive-key',
    postingPublicKey: 'not-a-hive-key',
    memoPublicKey: 'not-a-hive-key',
  }
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function ticketCredits(ticket: string): Promise<number> {
  const result = await db.execute({
    sql: `SELECT credits FROM Tickets WHERE code = ?`,
    args: [ticket],
  })
  return Number(result.rows[0]?.credits)
}

async function accountFields(username: string): Promise<{
  readonly executionMode: string
  readonly blockchainStatus: string
  readonly transactionId: string
} | null> {
  const result = await db.execute({
    sql: `SELECT execution_mode, blockchain_status, transaction_id
			FROM Accounts WHERE username = ?`,
    args: [username],
  })
  const row = result.rows[0]
  if (!row) return null
  return {
    executionMode: String(row.execution_mode),
    blockchainStatus: String(row.blockchain_status),
    transactionId: String(row.transaction_id),
  }
}

async function pendingFor(correlationId: string): Promise<number> {
  const pending = await getPendingReconciliations()
  return pending.filter(entry => entry.correlationId === correlationId).length
}

async function cleanupOwnRecords(fixture: IsolationFixture): Promise<void> {
  await db.execute({
    sql: `DELETE FROM Notifications WHERE hive_username = ?`,
    args: [fixture.builderUsername],
  })
  await db.execute({
    sql: `DELETE FROM CreditAudit WHERE hive_username = ?`,
    args: [fixture.builderId],
  })
  await db.execute({
    sql: `DELETE FROM CreationAttempts WHERE ticket = ?`,
    args: [fixture.ticket],
  })
  await db.execute({
    sql: `DELETE FROM Accounts WHERE username = ?`,
    args: [fixture.username],
  })
  await db.execute({
    sql: `DELETE FROM Tickets WHERE code = ?`,
    args: [fixture.ticket],
  })
  await db.execute({
    sql: `DELETE FROM Credits WHERE hive_username = ?`,
    args: [fixture.builderUsername],
  })
}

async function insertFixture(fixture: IsolationFixture): Promise<void> {
  await db.execute({
    sql: `INSERT INTO Credits (hive_username, pending_amount, available_amount, total_assigned, total_consumed)
			VALUES (?, 0, 10, 10, 0)`,
    args: [fixture.builderUsername],
  })
  await db.execute({
    sql: `INSERT INTO Tickets (code, description, original_credits, credits, creator_username)
			VALUES (?, 'integration sim', 3, 3, ?)`,
    args: [fixture.ticket, fixture.builderUsername],
  })
}

async function withFixture(
  run: (fixture: IsolationFixture) => Promise<void>
): Promise<void> {
  const fixture = isolationIds()
  await insertFixture(fixture)
  try {
    await run(fixture)
  } finally {
    await cleanupOwnRecords(fixture)
  }
}

async function reserveFor(
  fixture: IsolationFixture,
  params: ICreateAccountParams
): Promise<void> {
  const reserved = await reserveTicketCredit({
    ticketCode: fixture.ticket,
    correlationId: fixture.correlationId,
    username: fixture.username,
    keys: keysFromParams(params),
  })
  assert(reserved.success, reserved.error ?? 'reserve failed')
}

function assertSimulationTx(tx: HiveTransactionResult): void {
  assert(isSimulationSuccess(tx), 'Simulation did not pass WAX checks')
  assert(tx.broadcasted === false, 'Broadcast occurred during simulation')
  assert(
    tx.mode === HIVE_TX_MODE_VALUES.SIMULATE,
    `Expected mode simulate, got ${tx.mode}`
  )
  assert(tx.wax.onChainVerified, 'on-chain verification did not pass')
}

async function runCreatePipeline(): Promise<void> {
  await withFixture(async fixture => {
    const keys = await HiveKeys.generate(fixture.username)
    const params = keys.toCreateAccountParams(fixture.username)
    assert(
      (await ticketCredits(fixture.ticket)) === 3,
      'ticket should start at 3 credits'
    )

    await reserveFor(fixture, params)
    assert(
      (await getCreationAttempt(fixture.correlationId))?.status ===
        CREATION_ATTEMPT_STATUS.RESERVED,
      'attempt should be reserved'
    )
    assert(
      (await ticketCredits(fixture.ticket)) === 2,
      'reserve should consume one credit'
    )

    const tx = await createAccount(params, undefined, async snapshot => {
      const persisted = await persistAttemptPreparation(
        fixture.correlationId,
        snapshot
      )
      assert(persisted, 'Failed to persist prepared snapshot')
    })
    assertSimulationTx(tx)

    const prepared = await getCreationAttempt(fixture.correlationId)
    assert(
      prepared?.status === CREATION_ATTEMPT_STATUS.PREPARED,
      'attempt should be prepared'
    )
    assert(
      prepared?.transactionId === tx.id,
      'prepared snapshot id must match tx.id'
    )
    assert(
      prepared?.broadcasted === false,
      'prepared attempt must not be marked broadcasted'
    )

    await persistAttemptBroadcastOutcome(fixture.correlationId, tx)
    assert(
      (await getCreationAttempt(fixture.correlationId))?.status ===
        CREATION_ATTEMPT_STATUS.PREPARED,
      'simulate outcome must stay prepared, never broadcasting'
    )

    const dbResult = await completeAccountCreationInDB(
      fixture.username,
      fixture.ticket,
      fixture.correlationId,
      tx
    )
    assert(dbResult.success, dbResult.error ?? 'DB complete failed')

    const account = await accountFields(fixture.username)
    assert(
      account?.executionMode === HIVE_TX_MODE_VALUES.SIMULATE,
      'account mode must be simulate'
    )
    assert(
      account?.blockchainStatus === BLOCKCHAIN_STATUS.SIMULATED,
      'account status must be simulated'
    )
    assert(
      account?.transactionId === tx.id,
      'account tx id must match prepared tx'
    )
    assert(
      (await getCreationAttempt(fixture.correlationId))?.status ===
        CREATION_ATTEMPT_STATUS.COMPLETED,
      'attempt should be completed'
    )
    assert(
      (await pendingFor(fixture.correlationId)) === 0,
      'simulate must not enqueue reconciliation'
    )

    const rc = await simulateRcDelegation(
      fixture.username,
      RC_DELEGATION_AMOUNT
    )
    assert(rc !== null, 'RC simulation returned null')
    assert(isRcSimulationSuccess(rc), 'RC simulation predicate failed')
    assert(rc.broadcasted === false, 'RC simulation broadcasted')
    assert(
      rc.wax.onChainVerified === false,
      'RC simulation must skip on-chain verification'
    )
  })
}

async function runWaxFailureRollback(): Promise<void> {
  await withFixture(async fixture => {
    const params = invalidCreateParams(fixture.username)
    await reserveFor(fixture, params)
    assert(
      (await ticketCredits(fixture.ticket)) === 2,
      'reserve should consume one credit'
    )

    let waxFailed = false
    try {
      await createAccount(params)
    } catch {
      waxFailed = true
    }
    assert(waxFailed, 'invalid keys should fail WAX before broadcast')
    assert(
      (await getCreationAttempt(fixture.correlationId))?.status ===
        CREATION_ATTEMPT_STATUS.RESERVED,
      'failed WAX must leave the attempt reserved'
    )

    const rolled = await rollbackTicketReservation(
      fixture.ticket,
      fixture.correlationId
    )
    assert(rolled.success, rolled.error ?? 'rollback failed')
    assert(
      (await ticketCredits(fixture.ticket)) === 3,
      'rollback should restore the credit'
    )
    assert(
      (await getCreationAttempt(fixture.correlationId))?.status ===
        CREATION_ATTEMPT_STATUS.ROLLED_BACK,
      'attempt should be rolled_back'
    )
    assert(
      (await accountFields(fixture.username)) === null,
      'failed WAX must not persist Accounts'
    )
    assert(
      (await pendingFor(fixture.correlationId)) === 0,
      'failed WAX must not enqueue reconciliation'
    )
  })
}

const cases: readonly BatteryCase[] = [
  {
    name: 'create pipeline reserved→prepared→completed + RC',
    run: runCreatePipeline,
  },
  {
    name: 'WAX failure rolls back credit and skips Accounts',
    run: runWaxFailureRollback,
  },
]

async function main(): Promise<void> {
  requireSimulationMode()
  const ok = await initializeDatabase()
  if (!ok) throw new Error('DB init failed')

  const failures: string[] = []
  for (const testCase of cases) {
    try {
      await testCase.run()
      console.log(`PASS  ${testCase.name}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      failures.push(`${testCase.name}: ${message}`)
      console.error(`FAIL  ${testCase.name}: ${message}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length}/${cases.length} simulation cases failed`
    )
  }
  console.log(`INTEGRATION SIMULATION PASSED  ${cases.length}/${cases.length}`)
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  console.error(message)
  process.exit(1)
})
