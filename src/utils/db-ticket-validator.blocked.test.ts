import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'
import {
  blockHiveUsername,
  unblockHiveUsername,
} from '@/lib/auth/blocked-hive-accounts'
import { getCreationAttempt } from '@/lib/creation-attempts'
import {
  markTicketAsUsed,
  reserveTicketCredit,
  validateTicketInDB,
} from './db-ticket-validator'

const fixtureId = crypto.randomUUID().replace(/-/g, '')
const creator = `builder${fixtureId.slice(0, 8)}`
const ticketCode = `BLOCK${fixtureId.slice(0, 12).toUpperCase()}`
const correlationId = `blocked-${fixtureId}`
const reservation = {
  ticketCode,
  correlationId,
  username: `new${fixtureId.slice(0, 8)}`,
  keys: {
    ownerPublicKey: 'STMowner',
    activePublicKey: 'STMactive',
    postingPublicKey: 'STMposting',
    memoPublicKey: 'STMmemo',
  },
}

async function ticketState() {
  const result = await db.execute({
    sql: 'SELECT * FROM Tickets WHERE code = ?',
    args: [ticketCode],
  })
  return result.rows[0]
}

describe('blocked ticket creator', () => {
  beforeAll(async () => {
    expect(await initializeDatabase()).toBe(true)
    await db.execute({
      sql: 'INSERT INTO Tickets (code, original_credits, credits, creator_username) VALUES (?, 3, 3, ?)',
      args: [ticketCode, creator],
    })
  })

  afterAll(async () => {
    await db.execute({
      sql: 'DELETE FROM CreationAttempts WHERE ticket = ?',
      args: [ticketCode],
    })
    await db.execute({
      sql: 'DELETE FROM Tickets WHERE code = ?',
      args: [ticketCode],
    })
    await unblockHiveUsername(creator)
  })

  it('rejects consumption after validation if the creator is blocked, then restores the same ticket on unblock', async () => {
    // Validation may have succeeded before the admin blocks the creator.
    expect((await validateTicketInDB(ticketCode)).isValid).toBe(true)
    const before = await ticketState()
    await blockHiveUsername({
      hiveUsername: creator,
      blockedBy: 'admin',
      reason: 'abuse',
    })

    expect(await validateTicketInDB(ticketCode)).toEqual({
      isValid: false,
      error: 'Ticket temporalmente no disponible',
    })
    expect((await reserveTicketCredit(reservation)).success).toBe(false)
    expect(await markTicketAsUsed(ticketCode)).toBe(false)
    expect(await getCreationAttempt(correlationId)).toBeNull()
    expect(await ticketState()).toEqual(before)

    await unblockHiveUsername(creator)
    expect((await validateTicketInDB(ticketCode)).isValid).toBe(true)
    expect(await ticketState()).toEqual(before)
    expect((await reserveTicketCredit(reservation)).success).toBe(true)
    expect((await ticketState()).credits).toBe(2)
    expect(await getCreationAttempt(correlationId)).not.toBeNull()
  })
})
