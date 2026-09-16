import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IHiveChainInterface } from '@hiveio/wax'
import { fetchRcDelegationExists } from '@/lib/hive-rc-lookup'

const ORIGINAL_DELEGATOR = process.env.HIVE_DELEGATOR_ACCOUNT

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

describe('fetchRcDelegationExists', () => {
	it('uses chain.extend instead of an untyped rc_api cast', async () => {
		process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
		const list = vi.fn().mockResolvedValue({
			rc_direct_delegations: [
				{ from: 'aliento', to: 'hhlvdbf3fa78', delegated_rc: '50000000000' },
			],
		})
		const result = await fetchRcDelegationExists('hhlvdbf3fa78', chainWithList(list))
		expect(result).toEqual({ status: 'found' })
		expect(list).toHaveBeenCalledWith({
			start: ['aliento', 'hhlvdbf3fa78'],
			limit: 1,
		})
	})

	it('returns not_found when WAX lists no matching row', async () => {
		process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
		const list = vi.fn().mockResolvedValue({ rc_direct_delegations: [] })
		expect(await fetchRcDelegationExists('nobody', chainWithList(list))).toEqual({
			status: 'not_found',
		})
	})

	it('fails over to a backup endpoint on WaxUnknownRequestError', async () => {
		process.env.HIVE_DELEGATOR_ACCOUNT = 'aliento'
		const list = vi.fn()
			.mockRejectedValueOnce(new Error('network timeout POST https://api.hive.blog'))
			.mockResolvedValueOnce({
				rc_direct_delegations: [
					{ from: 'aliento', to: 'hhlvdbf3fa78', delegated_rc: 1 },
				],
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

		expect(await fetchRcDelegationExists('hhlvdbf3fa78', chain)).toEqual({
			status: 'found',
		})
		expect(list).toHaveBeenCalledTimes(2)
		expect(urls).toContain('https://api.openhive.network')
	})
})
