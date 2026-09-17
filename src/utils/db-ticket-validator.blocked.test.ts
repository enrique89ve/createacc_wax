import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'
import {
  blockHiveUsername,
  unblockHiveUsername,
} from '@/lib/auth/blocked-hive-accounts'
import { getCreationAttempt } from '@/lib/creation-attempts'
import { HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'
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
  executionMode: HIVE_TX_MODE_VALUES.SIMULATE,
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
      sql: 'INSERT INTO Tickets (code, total_uses, remaining_uses, creator_username) VALUES (?, 3, 3, ?)',
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
    expect((await ticketState()).remaining_uses).toBe(2)
    expect(await getCreationAttempt(correlationId)).not.toBeNull()
  })

  it('rejects a revoked ticket without changing its remaining uses', async () => {
    await db.execute({
      sql: 'UPDATE Tickets SET revoked_at = CURRENT_TIMESTAMP WHERE code = ?',
      args: [ticketCode],
    })
    expect((await validateTicketInDB(ticketCode)).isValid).toBe(false)
    expect(await ticketState()).toMatchObject({ remaining_uses: 2 })
    await db.execute({
      sql: 'UPDATE Tickets SET revoked_at = NULL WHERE code = ?',
      args: [ticketCode],
    })
  })
})
