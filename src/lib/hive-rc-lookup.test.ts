import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IHiveChainInterface } from '@hiveio/wax'
import { RC_DELEGATION_AMOUNT } from '@/consts/constants'
import { fetchRcDelegationExists } from '@/lib/hive-rc-lookup'

const ORIGINAL_DELEGATOR = process.env.HIVE_DELEGATOR_ACCOUNT
const DELEGATEE = 'hhlvdbf3fa78'

afterEach(() => {
	if (ORIGINAL_DELEGATOR === undefined) delete process.env.HIVE_DELEGATOR_ACCOUNT
	else process.env.HIVE_DELEGATOR_ACCOUNT = ORIGINAL_DELEGATOR
	vi.restoreAllMocks()
})

function chainWithList(
	list: ReturnType<typeof vi.fn>
): IHiveChainInterface {
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
		const result = await fetchRcDelegationExists(DELEGATEE, chainWithList(list))
		expect(result).toEqual({ status: 'found' })
		expect(list).toHaveBeenCalledWith({
			start: ['aliento', DELEGATEE],
			limit: 1,
		})
	})

	it.each([
		['50000000000', 'found'],
		[50_000_000_000, 'found'],
		[0, 'not_found'],
		[1, 'not_found'],
		[49_999_999_999, 'not_found'],
		[50_000_000_001, 'not_found'],
		['49999999999', 'not_found'],
		['not-a-number', 'not_found'],
		['', 'not_found'],
	] as const)('delegated_rc=%j is %s', async (amount, status) => {
		process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
		const list = vi.fn().mockResolvedValue({
			rc_direct_delegations: [row(amount)],
		})
		expect(await fetchRcDelegationExists(DELEGATEE, chainWithList(list))).toEqual({
			status,
		})
	})

	it('returns not_found when WAX lists no matching row', async () => {
		process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
		const list = vi.fn().mockResolvedValue({ rc_direct_delegations: [] })
		expect(await fetchRcDelegationExists('nobody', chainWithList(list))).toEqual({
			status: 'not_found',
		})
	})

	it('fails over to a backup endpoint on network error', async () => {
		process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
		const list = vi.fn()
			.mockRejectedValueOnce(new Error('network timeout POST https://api.hive.blog'))
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
		})
		expect(list).toHaveBeenCalledTimes(2)
		expect(urls).toContain('https://api.openhive.network')
	})
})
