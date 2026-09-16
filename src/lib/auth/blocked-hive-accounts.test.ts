import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, initializeDatabase } from '@/lib/database'
import { assignCredits } from '@/lib/credits/admin'
import { getBalance } from '@/lib/credit-balance-tracker'
import {
  blockHiveUsername,
  isHiveUsernameBlocked,
  unblockHiveUsername,
} from '@/lib/auth/blocked-hive-accounts'

const PREFIX = `block-${Date.now()}`

describe('BlockedHiveAccounts', () => {
  beforeAll(async () => {
    await initializeDatabase()
  })

  beforeEach(async () => {
    await db.execute({ sql: 'DELETE FROM BlockedHiveAccounts', args: [] })
  })

  afterAll(async () => {
    await db.execute({ sql: 'DELETE FROM BlockedHiveAccounts', args: [] })
  })

  it('blocks and unblocks a Hive username without touching credits', async () => {
    const username = `${PREFIX}-keep`
    await assignCredits({
      hive_username: username,
      amount: 4,
      assigned_by_admin: 'admin',
      source: 'manual',
    })

    await blockHiveUsername({
      hiveUsername: `@${username.toUpperCase()}`,
      blockedBy: 'admin',
      reason: 'abuse',
    })

    expect(await isHiveUsernameBlocked(username)).toBe(true)
    expect((await getBalance(username)).pending_amount).toBe(4)

    const unblocked = await unblockHiveUsername(username)
    expect(unblocked).toBe(username)
    expect(await isHiveUsernameBlocked(username)).toBe(false)
    expect((await getBalance(username)).pending_amount).toBe(4)
  })

  it('returns null when unblocking a username that is not blocked', async () => {
    expect(await unblockHiveUsername(`${PREFIX}-none`)).toBeNull()
  })
})
