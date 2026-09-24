import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'
import { claimCreationAttempt } from '@/lib/creation-attempts'
import {
  rollbackTicketReservation,
  reserveTicketCredit,
} from '@/utils/db-ticket-validator'
import { archiveOwnedTicket } from '@/lib/tickets/archive-ticket'
import { db, initializeDatabase } from '@/lib/database'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'

const RUN = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
const BUILDER = `archbuilder${RUN}`
const TICKET = `ARCH${RUN.toUpperCase()}`
const OPEN_CORRELATION = `archive-open-${RUN}`

async function cleanup(): Promise<void> {
  await db.execute({
    sql: 'DELETE FROM CreationAttemptEvents WHERE correlation_id = ?',
    args: [OPEN_CORRELATION],
  })
  await db.execute({
    sql: 'DELETE FROM CreationAttempts WHERE correlation_id = ?',
    args: [OPEN_CORRELATION],
  })
  await db.execute({
    sql: 'DELETE FROM TicketAudit WHERE ticket = ?',
    args: [TICKET],
  })
  await db.execute({
    sql: 'DELETE FROM Tickets WHERE code = ?',
    args: [TICKET],
  })
  await db.execute({
    sql: 'DELETE FROM CreditAudit WHERE hive_username = ?',
    args: [BUILDER],
  })
  await db.execute({
    sql: 'DELETE FROM Credits WHERE hive_username = ?',
    args: [BUILDER],
  })
}

beforeAll(async () => {
  expect(await initializeDatabase()).toBe(true)
  await cleanup()
  await db.execute({
    sql: `INSERT INTO Credits (hive_username, available_amount, total_issued)
          VALUES (?, 10, 10)`,
    args: [BUILDER],
  })
  await ticketsRepository.create({
    code: TICKET,
    total_uses: 4,
    remaining_uses: 4,
    creator_username: BUILDER,
    funding_source: 'builder_credits',
    owner_builder_username: BUILDER,
  })
})

afterAll(cleanup)

describe('archiveOwnedTicket', () => {
  it('blocks open attempts, refunds remaining uses once, and keeps the code reserved', async () => {
    const ticket = await ticketsRepository.findByCode(TICKET)
    expect(ticket).not.toBeNull()
    if (!ticket) throw new Error('Ticket fixture was not created')

    const reserved = await reserveTicketCredit({
      ticketCode: TICKET,
      correlationId: OPEN_CORRELATION,
      username: `newaccount${RUN}`,
      keys: {
        ownerPublicKey: 'STM7ownerArchiveTest',
        activePublicKey: 'STM7activeArchiveTest',
        postingPublicKey: 'STM7postingArchiveTest',
        memoPublicKey: 'STM7memoArchiveTest',
      },
      executionMode: HIVE_TX_MODE_VALUES.SIMULATE,
    })
    expect(reserved.success).toBe(true)

    const blocked = await archiveOwnedTicket(ticket.id, BUILDER)
    expect(blocked).toMatchObject({ kind: 'open_attempts', count: 1 })
    const beforeRollback = await ticketsRepository.findById(ticket.id)
    expect(beforeRollback).toMatchObject({
      remaining_uses: 3,
      archived_at: null,
    })

    const lease = await claimCreationAttempt(OPEN_CORRELATION)
    expect(lease).not.toBeNull()
    expect(
      (await rollbackTicketReservation(OPEN_CORRELATION, lease!)).success
    ).toBe(true)
    await db.execute({
      sql: 'UPDATE Tickets SET remaining_uses = 3 WHERE id = ?',
      args: [ticket.id],
    })

    await db.execute({
      sql: 'DELETE FROM Credits WHERE hive_username = ?',
      args: [BUILDER],
    })
    await expect(archiveOwnedTicket(ticket.id, BUILDER)).rejects.toThrow(
      'Cannot refund ticket uses without Credits row'
    )
    const afterFailedRefund = await ticketsRepository.findById(ticket.id)
    expect(afterFailedRefund).toMatchObject({
      remaining_uses: 3,
      archived_at: null,
      retired_uses: 0,
    })
    const auditAfterFailedRefund = await db.execute({
      sql: 'SELECT COUNT(*) AS count FROM TicketAudit WHERE ticket = ?',
      args: [TICKET],
    })
    expect(Number(auditAfterFailedRefund.rows[0]?.count)).toBe(0)
    await db.execute({
      sql: `INSERT INTO Credits (hive_username, available_amount, total_issued)
            VALUES (?, 10, 10)`,
      args: [BUILDER],
    })

    const archived = await archiveOwnedTicket(ticket.id, BUILDER)
    expect(archived.kind).toBe('archived')
    if (archived.kind !== 'archived') throw new Error('Ticket was not archived')
    expect(archived.ticket).toMatchObject({
      remaining_uses: 0,
      retired_uses: 3,
      used_uses: 1,
      status: 'archived',
      is_active: false,
    })

    const replay = await archiveOwnedTicket(ticket.id, BUILDER)
    expect(replay.kind).toBe('already_archived')
    if (replay.kind !== 'already_archived') {
      throw new Error('Repeated archive did not return persisted archive')
    }
    expect(replay.ticket.retired_uses).toBe(3)

    const credits = await db.execute({
      sql: 'SELECT available_amount FROM Credits WHERE hive_username = ?',
      args: [BUILDER],
    })
    expect(Number(credits.rows[0]?.available_amount)).toBe(13)
    const refunds = await db.execute({
      sql: `SELECT COUNT(*) AS count, MAX(external_reference) AS external_reference FROM CreditAudit
            WHERE hive_username = ? AND operation = 'delete_ticket_refund'`,
      args: [BUILDER],
    })
    expect(Number(refunds.rows[0]?.count)).toBe(1)
    expect(refunds.rows[0]?.external_reference).toBe(
      `ticket:${ticket.id}:archive-refund`
    )
    const archiveAudit = await db.execute({
      sql: `SELECT ticket_id, action, actor_type, actor_id, delta,
                   before_uses, after_uses, operation_reference
            FROM TicketAudit WHERE ticket_id = ?`,
      args: [ticket.id],
    })
    expect(archiveAudit.rows).toHaveLength(1)
    expect(archiveAudit.rows[0]).toMatchObject({
      ticket_id: ticket.id,
      action: 'archived',
      actor_type: 'builder',
      actor_id: BUILDER,
      delta: -3,
      before_uses: 3,
      after_uses: 0,
      operation_reference: `ticket:${ticket.id}:archive`,
    })

    await expect(
      ticketsRepository.create({
        code: TICKET,
        total_uses: 1,
        remaining_uses: 1,
        creator_username: BUILDER,
        funding_source: 'builder_credits',
        owner_builder_username: BUILDER,
      })
    ).rejects.toThrow(/unique/i)
  })
})
