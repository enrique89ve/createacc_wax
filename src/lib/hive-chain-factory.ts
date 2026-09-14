import {
	createHiveChain,
	HealthChecker,
	type GetDynamicGlobalPropertiesResponse,
	type IHiveChainInterface,
	type TScoredEndpoint,
} from '@hiveio/wax'
import { BRAND } from '@/consts/branding'
import { HIVE_CHAIN_CONFIG } from '@/consts/constants'
import { shouldTriggerWaxFailover } from '@/lib/wax-error-utils'

export type HiveChain = IHiveChainInterface

const sleep = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms))

function sharedChainOptions(apiEndpoint: string) {
	return {
		apiEndpoint,
		apiTimeout: HIVE_CHAIN_CONFIG.API_TIMEOUT_MS,
		waxApiCaller: BRAND.APP_ID,
	}
}

async function createChainAt(apiEndpoint: string): Promise<IHiveChainInterface> {
	return await createHiveChain(sharedChainOptions(apiEndpoint))
}

async function findBestBackup(backups: readonly string[]): Promise<string> {
	const firstBackup = backups[0]
	if (!firstBackup) {
		throw new Error('No backup endpoints configured')
	}

	const healthChecker = new HealthChecker(
		[...backups],
		HIVE_CHAIN_CONFIG.HEALTH_CHECK_TIMEOUT_MS
	)

	try {
		const tempChain = await createChainAt(firstBackup)

		healthChecker.register(
			tempChain.api.database_api.get_dynamic_global_properties,
			{},
			(data: GetDynamicGlobalPropertiesResponse): true | string => {
				return data?.id === 0 ? true : 'invalid dgp'
			}
		)

		await sleep(HIVE_CHAIN_CONFIG.HEALTH_EVALUATION_DELAY_MS)

		const endpoints: TScoredEndpoint[] = healthChecker.list()
		const bestEndpoint = endpoints
			.filter(ep => ep.up)
			.sort((a, b) => b.score - a.score)[0]

		try {
			tempChain.delete()
		} catch {
			/* best-effort WASM cleanup */
		}

		if (bestEndpoint) {
			return bestEndpoint.endpointUrl
		}

		throw new Error('No healthy backup found')
	} finally {
		healthChecker.unregisterAll(true)
	}
}

async function tryBackupsSequentially(
	backups: readonly string[]
): Promise<IHiveChainInterface> {
	for (const endpoint of backups) {
		try {
			return await createChainAt(endpoint)
		} catch {
			// Continue to next backup
		}
	}
	throw new Error('All backup endpoints failed')
}

/**
 * Creates a Hive chain always pointed at mainnet, with hybrid failover.
 */
export async function createFreshChain(): Promise<IHiveChainInterface> {
	try {
		return await createChainAt(HIVE_CHAIN_CONFIG.MAINNET_DEFAULT)
	} catch (error) {
		if (!shouldTriggerWaxFailover(error)) {
			throw error
		}

		try {
			const bestBackupUrl = await findBestBackup(HIVE_CHAIN_CONFIG.MAINNET_BACKUPS)
			return await createChainAt(bestBackupUrl)
		} catch {
			try {
				return await tryBackupsSequentially(HIVE_CHAIN_CONFIG.MAINNET_BACKUPS)
			} catch {
				throw new Error('All Hive APIs are unavailable')
			}
		}
	}
}
