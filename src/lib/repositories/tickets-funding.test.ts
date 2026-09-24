import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { db, initializeDatabase, insertAdminUser } from '@/lib/database'
import {
  reserveTicketCredit,
  completeAccountCreationInDB,
} from '@/utils/db-ticket-validator'
import type { HiveTransactionResult } from '@/types/hive-transaction'

const RUN = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
const SHARED_USERNAME = `builder${RUN}`
const BUILDER_TICKET = `BLD${RUN.toUpperCase()}`
const SYSTEM_TICKET = `SYS${RUN.toUpperCase()}`
const ACCOUNT_USERNAME = `account${RUN}`
const CORRELATION_ID = `funding-${RUN}`
let adminId = ''
let systemTicketId = 0

const keys = {
  ownerPublicKey: 'STM7ownerFundingTest',
  activePublicKey: 'STM7activeFundingTest',
  postingPublicKey: 'STM7postingFundingTest',
  memoPublicKey: 'STM7memoFundingTest',
} as const

const simulatedTransaction: HiveTransactionResult = {
  id: `sim-${RUN}`,
  mode: HIVE_TX_MODE_VALUES.SIMULATE,
  broadcasted: false,
  wax: {
    validated: true,
    onChainVerified: true,
    signed: true,
    authorityVerified: true,
  },
  requiredAuthorities: {},
  signaturePublicKeys: [],
}

async function cleanup(): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM CreationAttempts WHERE correlation_id = ?',
    args: [CORRELATION_ID],
  })
  await db.execute({
    sql: 'DELETE FROM Accounts WHERE username = ?',
    args: [ACCOUNT_USERNAME],
  })
  await db.execute({
    sql: 'DELETE FROM Tickets WHERE code IN (?, ?)',
    args: [BUILDER_TICKET, SYSTEM_TICKET],
  })
  await db.execute({
    sql: 'DELETE FROM Credits WHERE hive_username = ?',
    args: [SHARED_USERNAME],
  })
  if (adminId) {
    await db.execute({
      sql: 'DELETE FROM "user" WHERE id = ?',
      args: [adminId],
    })
  }
}

beforeAll(async () => {
  expect(await initializeDatabase()).toBe(true)
  await cleanup()
  adminId = await insertAdminUser({
    username: SHARED_USERNAME,
    passwordHash: 'test-only-password-hash',
  })
  await db.execute({
    sql: `INSERT INTO Credits (hive_username, available_amount, total_issued, total_consumed)
          VALUES (?, 3, 3, 0)`,
    args: [SHARED_USERNAME],
  })
  await ticketsRepository.create({
    code: BUILDER_TICKET,
    total_uses: 1,
    remaining_uses: 1,
    creator_username: SHARED_USERNAME,
    funding_source: 'builder_credits',
    owner_builder_username: SHARED_USERNAME,
  })
  const systemTicket = await ticketsRepository.create({
    code: SYSTEM_TICKET,
    total_uses: 1,
    remaining_uses: 1,
    creator_username: SHARED_USERNAME,
    funding_source: 'system',
    issuer_admin_id: adminId,
  })
  systemTicketId = systemTicket.id
})

afterAll(cleanup)

describe('ticket funding and ownership', () => {
  it('keeps same-name Admin tickets outside Builder ownership and Credits', async () => {
    const builderTickets =
      await ticketsRepository.getBuilderTicketsWithCreator(SHARED_USERNAME)
    expect(builderTickets.map(ticket => ticket.code)).toEqual([BUILDER_TICKET])
    expect(
      await ticketsRepository.updateOwnedUses(
        systemTicketId,
        SHARED_USERNAME,
        -1
      )
    ).toBeNull()

    const reserved = await reserveTicketCredit({
      ticketCode: SYSTEM_TICKET,
      correlationId: CORRELATION_ID,
      username: ACCOUNT_USERNAME,
      keys,
      executionMode: HIVE_TX_MODE_VALUES.SIMULATE,
    })
    expect(reserved.success).toBe(true)

    const completed = await completeAccountCreationInDB(
      ACCOUNT_USERNAME,
      SYSTEM_TICKET,
      CORRELATION_ID,
      simulatedTransaction
    )
    expect(completed.success).toBe(true)

    const account = await db.execute({
      sql: 'SELECT ticket_id, builder_username FROM Accounts WHERE username = ?',
      args: [ACCOUNT_USERNAME],
    })
    expect(Number(account.rows[0]?.ticket_id)).toBe(systemTicketId)
    expect(account.rows[0]?.builder_username).toBeNull()

    const credits = await db.execute({
      sql: 'SELECT available_amount, total_consumed FROM Credits WHERE hive_username = ?',
      args: [SHARED_USERNAME],
    })
    expect(Number(credits.rows[0]?.available_amount)).toBe(3)
    expect(Number(credits.rows[0]?.total_consumed)).toBe(0)

    const systemRow = (await ticketsRepository.getAllWithCreators()).find(
      ticket => ticket.code === SYSTEM_TICKET
    )
    expect(systemRow).toMatchObject({
      funding_source: 'system',
      owner_builder_username: null,
      issuer_admin_id: adminId,
      creator_role: 'admin',
    })
    expect(systemRow?.status).toBe('exhausted')
  })
})
