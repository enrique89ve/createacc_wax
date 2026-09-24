import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'
import { auditRepository } from '@/lib/repositories/audit-repository'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'

const RUN = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
const TICKET = `AUDIT${RUN.toUpperCase()}`
const REFERENCE = `ticket-audit-test:${RUN}`
let ticketId = 0

beforeAll(async () => {
  expect(await initializeDatabase()).toBe(true)
  const ticket = await ticketsRepository.create({
    code: TICKET,
    total_uses: 2,
    remaining_uses: 2,
    creator_username: `builder${RUN}`,
    funding_source: 'builder_credits',
    owner_builder_username: `builder${RUN}`,
  })
  ticketId = ticket.id
})

afterAll(async () => {
  await db.execute({
    sql: 'DELETE FROM TicketAudit WHERE ticket_id = ?',
    args: [ticketId],
  })
  await db.execute({
    sql: 'DELETE FROM Tickets WHERE id = ?',
    args: [ticketId],
  })
})

describe('ticket lifecycle audit', () => {
  it('persists identity, actor, before/after values and unique operation reference', async () => {
    const event = {
      ticketId,
      ticket: TICKET,
      action: 'uses_adjusted' as const,
      actorType: 'builder' as const,
      actorId: `builder${RUN}`,
      delta: -1,
      beforeUses: 2,
      afterUses: 1,
      beforeState: { remainingUses: 2 },
      afterState: { remainingUses: 1 },
      operationReference: REFERENCE,
    }
    await auditRepository.createTicketLog(event)
    const logs = await auditRepository.getLogsByTicket(TICKET)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      ticket_id: ticketId,
      action: 'uses_adjusted',
      actor_type: 'builder',
      actor_id: `builder${RUN}`,
      performed_by_username: `builder${RUN}`,
      delta: -1,
      before_uses: 2,
      after_uses: 1,
      before_state: '{"remainingUses":2}',
      after_state: '{"remainingUses":1}',
      operation_reference: REFERENCE,
    })
    await expect(auditRepository.createTicketLog(event)).rejects.toThrow()
    expect(await auditRepository.getLogsByTicket(TICKET)).toHaveLength(1)
    await expect(
      db.execute({ sql: 'DELETE FROM Tickets WHERE id = ?', args: [ticketId] })
    ).rejects.toThrow()
  })
})
