import { createHiveChain, HealthChecker } from '@hiveio/wax'

export type HiveChain = Awaited<ReturnType<typeof createHiveChain>>

const HIVE_HEALTH_ENDPOINTS: readonly string[] = [
	'https://techcoderx.com',
	'https://api.openhive.network',
	'https://rpc.mahdiyari.info',
] as const

const sleep = (ms: number): Promise<void> =>
	new Promise(r => setTimeout(r, ms))

let cachedChain: HiveChain | null = null
let creatingChainPromise: Promise<HiveChain | null> | null = null

async function tryCreateChain(endpoint?: string): Promise<HiveChain | null> {
	try {
		return endpoint
			? await createHiveChain({ apiEndpoint: endpoint })
			: await createHiveChain()
	} catch {
		return null
	}
}

async function tryHealthCheckerEndpoint(): Promise<HiveChain | null> {
	const healthChecker = new HealthChecker([...HIVE_HEALTH_ENDPOINTS], 4000)
	try {
		const temp = await tryCreateChain(HIVE_HEALTH_ENDPOINTS[0])
		if (temp) {
			healthChecker.register(
				temp.api.database_api.get_dynamic_global_properties,
				{},
				(data): true | string => (data?.id === 0 ? true : 'invalid dgp')
			)
		}

		await sleep(1200)
		const best = healthChecker
			.list()
			.filter(e => e.up)
			.sort((a, b) => b.score - a.score)[0]

		if (best) return await tryCreateChain(best.endpointUrl)
		return null
	} finally {
		healthChecker.unregisterAll(true)
	}
}

async function tryEndpointsSequentially(): Promise<HiveChain | null> {
	for (const ep of HIVE_HEALTH_ENDPOINTS) {
		const chain = await tryCreateChain(ep)
		if (chain) return chain
	}
	return null
}

async function createHiveChainWithFallback(): Promise<HiveChain | null> {
	return (await tryCreateChain())
		?? (await tryHealthCheckerEndpoint())
		?? (await tryEndpointsSequentially())
}

export async function getHiveChain(): Promise<HiveChain | null> {
	if (cachedChain) return cachedChain
	if (creatingChainPromise) return creatingChainPromise
	creatingChainPromise = (async () => {
		const chain = await createHiveChainWithFallback()
		if (chain) cachedChain = chain
		creatingChainPromise = null
		return chain
	})()
	return creatingChainPromise
}

export function disposeHiveChain(): void {
	if (cachedChain) {
		try {
			cachedChain.delete()
		} catch {
			// Non-critical: chain may already be deleted or in invalid state
		}
		cachedChain = null
	}
}
