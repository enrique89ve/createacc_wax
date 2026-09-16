import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { initializeDatabase, db } from '@/lib/database'
import {
  BLOCKCHAIN_STATUS,
  HIVE_TX_MODE_VALUES,
  RC_STATUS,
} from '@/consts/hive-execution'
import { RC_DELEGATION_AMOUNT } from '@/consts/constants'
import { fetchRcDelegationExists } from '@/lib/hive-rc-lookup'
import {
  applyUncertainRcLookup,
  confirmExistingRcDelegation,
  reconcileUncertainRcDelegations,
} from '@/lib/create/queue-rc-delegation'

vi.mock('@/lib/hive-rc-lookup', () => ({
  fetchRcDelegationExists: vi.fn(),
}))

vi.mock('@/lib/create/delegate-rc', () => ({
  delegateResourceCredits: vi.fn(),
  simulateRcDelegation: vi.fn().mockResolvedValue(null),
}))

const fetchLookup = vi.mocked(fetchRcDelegationExists)
const RUN = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
const TICKET = `RCUT${RUN.toUpperCase()}`

async function insertUncertain(
  username: string,
  rcStatus: (typeof RC_STATUS)[keyof typeof RC_STATUS] = RC_STATUS.UNCERTAIN
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO Accounts (
			username, ticket, builder_username, execution_mode, blockchain_status, rc_status, rc_delegated
		) VALUES (?, ?, ?, ?, ?, ?, 0)`,
    args: [
      username,
      TICKET,
      'sim-builder',
      HIVE_TX_MODE_VALUES.BROADCAST,
      BLOCKCHAIN_STATUS.CONFIRMED,
      rcStatus,
    ],
  })
}

async function rcRow(username: string): Promise<{
  readonly rcStatus: string
  readonly rcDelegated: number
}> {
  const result = await db.execute({
    sql: `SELECT rc_status, rc_delegated FROM Accounts WHERE username = ?`,
    args: [username],
  })
  return {
    rcStatus: String(result.rows[0]?.rc_status),
    rcDelegated: Number(result.rows[0]?.rc_delegated),
  }
}

beforeAll(async () => {
  expect(await initializeDatabase()).toBe(true)
  await db.execute({
    sql: `DELETE FROM Accounts WHERE ticket = ?`,
    args: [TICKET],
  })
}, 30_000)

afterAll(async () => {
  await db.execute({
    sql: `DELETE FROM Accounts WHERE ticket = ?`,
    args: [TICKET],
  })
})

beforeEach(() => {
  fetchLookup.mockReset()
})

describe('uncertain RC recovery', () => {
  it('exact Hive amount marks delegated', async () => {
    const username = `rcuex${RUN}`
    await insertUncertain(username)
    expect(
      await applyUncertainRcLookup(username, {
        status: 'found',
        delegatedRc: BigInt(RC_DELEGATION_AMOUNT),
      })
    ).toBe('delegated')
    expect(await rcRow(username)).toEqual({
      rcStatus: RC_STATUS.DELEGATED,
      rcDelegated: 1,
    })
  })

  it('absent delegation returns to pending for retry', async () => {
    const username = `rcuab${RUN}`
    await insertUncertain(username)
    expect(
      await applyUncertainRcLookup(username, { status: 'not_found' })
    ).toBe('retry')
    expect(await rcRow(username)).toEqual({
      rcStatus: RC_STATUS.PENDING,
      rcDelegated: 0,
    })
  })

  it('mismatch stays uncertain and does not retransmit', async () => {
    const username = `rcumi${RUN}`
    await insertUncertain(username)
    expect(
      await applyUncertainRcLookup(username, {
        status: 'mismatch',
        delegatedRc: 1n,
      })
    ).toBe('hold')
    expect(await rcRow(username)).toEqual({
      rcStatus: RC_STATUS.UNCERTAIN,
      rcDelegated: 0,
    })
  })

  it('RPC error stays uncertain and does not retransmit', async () => {
    const username = `rcuer${RUN}`
    await insertUncertain(username)
    expect(
      await applyUncertainRcLookup(username, {
        status: 'error',
        message: 'POST failed',
      })
    ).toBe('hold')
    expect(await rcRow(username)).toEqual({
      rcStatus: RC_STATUS.UNCERTAIN,
      rcDelegated: 0,
    })
  })

  it('reconcileUncertainRcDelegations applies the four Hive outcomes', async () => {
    const exact = `rcrex${RUN}`
    const absent = `rcrab${RUN}`
    const mismatch = `rcrmi${RUN}`
    const rpcError = `rcrer${RUN}`
    await insertUncertain(exact)
    await insertUncertain(absent)
    await insertUncertain(mismatch)
    await insertUncertain(rpcError)
    fetchLookup.mockImplementation(async (username: string) => {
      if (username === exact) {
        return { status: 'found', delegatedRc: BigInt(RC_DELEGATION_AMOUNT) }
      }
      if (username === absent) return { status: 'not_found' }
      if (username === mismatch) return { status: 'mismatch', delegatedRc: 1n }
      return { status: 'error', message: 'rpc down' }
    })

    const resolved = await reconcileUncertainRcDelegations()
    expect(resolved).toBeGreaterThanOrEqual(2)
    expect(await rcRow(exact)).toMatchObject({ rcStatus: RC_STATUS.DELEGATED })
    expect(await rcRow(mismatch)).toMatchObject({
      rcStatus: RC_STATUS.UNCERTAIN,
    })
    expect(await rcRow(rpcError)).toMatchObject({
      rcStatus: RC_STATUS.UNCERTAIN,
    })
    const absentRow = await rcRow(absent)
    expect([RC_STATUS.PENDING, RC_STATUS.PROCESSING]).toContain(
      absentRow.rcStatus
    )
  })
})

describe('RC_DELEGATION_EXISTS', () => {
  it('marks delegated only when Hive amount is exact', async () => {
    const username = `rcex${RUN}`
    await insertUncertain(username, RC_STATUS.PROCESSING)
    fetchLookup.mockResolvedValue({
      status: 'found',
      delegatedRc: BigInt(RC_DELEGATION_AMOUNT),
    })
    await confirmExistingRcDelegation(username)
    expect(await rcRow(username)).toEqual({
      rcStatus: RC_STATUS.DELEGATED,
      rcDelegated: 1,
    })
  })

  it('keeps uncertain when Hive amount mismatches', async () => {
    const username = `rcmm${RUN}`
    await insertUncertain(username, RC_STATUS.PROCESSING)
    fetchLookup.mockResolvedValue({ status: 'mismatch', delegatedRc: 1n })
    await confirmExistingRcDelegation(username)
    expect(await rcRow(username)).toEqual({
      rcStatus: RC_STATUS.UNCERTAIN,
      rcDelegated: 0,
    })
  })
})
