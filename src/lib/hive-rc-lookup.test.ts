import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IHiveChainInterface } from '@hiveio/wax'
import { RC_DELEGATION_AMOUNT } from '@/consts/constants'
import { fetchRcDelegationExists } from '@/lib/hive-rc-lookup'

const ORIGINAL_DELEGATOR = process.env.HIVE_DELEGATOR_ACCOUNT
const DELEGATEE = 'hhlvdbf3fa78'
const EXPECTED = BigInt(RC_DELEGATION_AMOUNT)

afterEach(() => {
  if (ORIGINAL_DELEGATOR === undefined)
    delete process.env.HIVE_DELEGATOR_ACCOUNT
  else process.env.HIVE_DELEGATOR_ACCOUNT = ORIGINAL_DELEGATOR
  vi.restoreAllMocks()
})

function chainWithList(list: ReturnType<typeof vi.fn>): IHiveChainInterface {
  return {
    endpointUrl: 'https://api.hive.blog',
    extend: () => ({
      api: {
        rc_api: {
          list_rc_direct_delegations: list,
          get endpointUrl() {
            return 'https://api.hive.blog'
          },
          set endpointUrl(_url: string | undefined) {},
        },
      },
    }),
  } as unknown as IHiveChainInterface
}

function row(delegatedRc: string | number, from = 'aliento', to = DELEGATEE) {
  return { from, to, delegated_rc: delegatedRc }
}

describe('fetchRcDelegationExists', () => {
  it('uses chain.extend instead of an untyped rc_api cast', async () => {
    process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
    const list = vi.fn().mockResolvedValue({
      rc_direct_delegations: [row(RC_DELEGATION_AMOUNT)],
    })
    expect(
      await fetchRcDelegationExists(DELEGATEE, chainWithList(list))
    ).toEqual({
      status: 'found',
      delegatedRc: EXPECTED,
    })
    expect(list).toHaveBeenCalledWith({
      start: ['aliento', DELEGATEE],
      limit: 1,
    })
  })

  it('returns found with the exact expected amount', async () => {
    process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
    const list = vi.fn().mockResolvedValue({
      rc_direct_delegations: [row(50_000_000_000)],
    })
    expect(
      await fetchRcDelegationExists(DELEGATEE, chainWithList(list))
    ).toEqual({
      status: 'found',
      delegatedRc: EXPECTED,
    })
  })

  it.each([
    [0, 0n],
    [1, 1n],
    [49_999_999_999, 49_999_999_999n],
    [50_000_000_001, 50_000_000_001n],
    ['49999999999', 49_999_999_999n],
  ] as const)('delegated_rc=%j is mismatch', async (amount, delegatedRc) => {
    process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
    const list = vi.fn().mockResolvedValue({
      rc_direct_delegations: [row(amount)],
    })
    expect(
      await fetchRcDelegationExists(DELEGATEE, chainWithList(list))
    ).toEqual({
      status: 'mismatch',
      delegatedRc,
    })
  })

  it.each(['not-a-number', ''] as const)(
    'malformed delegated_rc=%j is error',
    async amount => {
      process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
      const list = vi.fn().mockResolvedValue({
        rc_direct_delegations: [row(amount)],
      })
      expect(
        await fetchRcDelegationExists(DELEGATEE, chainWithList(list))
      ).toEqual({
        status: 'error',
        message: 'Malformed delegated_rc',
      })
    }
  )

  it('returns not_found when WAX lists no matching row', async () => {
    process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
    const list = vi.fn().mockResolvedValue({ rc_direct_delegations: [] })
    expect(
      await fetchRcDelegationExists('nobody', chainWithList(list))
    ).toEqual({
      status: 'not_found',
    })
  })

  it('returns error when the RPC fails', async () => {
    process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
    const list = vi
      .fn()
      .mockRejectedValue(new Error('business assertion failed'))
    expect(
      await fetchRcDelegationExists(DELEGATEE, chainWithList(list))
    ).toEqual({
      status: 'error',
      message: 'business assertion failed',
    })
  })

  it('fails over to a backup endpoint on network error', async () => {
    process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
    const list = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('network timeout POST https://api.hive.blog')
      )
      .mockResolvedValueOnce({
        rc_direct_delegations: [row(RC_DELEGATION_AMOUNT)],
      })
    const urls: Array<string | undefined> = []
    const chain = {
      endpointUrl: 'https://api.hive.blog',
      extend: () => ({
        api: {
          rc_api: {
            list_rc_direct_delegations: list,
            get endpointUrl() {
              return urls.at(-1)
            },
            set endpointUrl(url: string | undefined) {
              urls.push(url)
            },
          },
        },
      }),
    } as unknown as IHiveChainInterface

    expect(await fetchRcDelegationExists(DELEGATEE, chain)).toEqual({
      status: 'found',
      delegatedRc: EXPECTED,
    })
    expect(list).toHaveBeenCalledTimes(2)
    expect(urls).toContain('https://api.openhive.network')
  })
})
