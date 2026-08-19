import {
	createHiveChain,
	HealthChecker,
	type GetDynamicGlobalPropertiesResponse,
	type IHiveChainInterface,
	type TScoredEndpoint,
} from '@hiveio/wax'
import { BRAND } from '@/consts/branding'
import { HIVE_CHAIN_CONFIG } from '@/consts/constants'
import { getBooleanEnv } from '@/lib/env'
import { shouldTriggerWaxFailover } from '@/lib/wax-error-utils'

export type HiveChain = IHiveChainInterface

const sleep = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms))

export const isMainnet = (): boolean => getBooleanEnv('MAINNET')

export type HiveNetworkMode = 'mainnet' | 'testnet'

function shouldUseMainnet(mode?: HiveNetworkMode): boolean {
	if (mode === 'mainnet') return true
	if (mode === 'testnet') return false
	return isMainnet()
}

function sharedChainOptions(apiEndpoint: string, chainId?: string) {
	return {
		apiEndpoint,
		apiTimeout: HIVE_CHAIN_CONFIG.API_TIMEOUT_MS,
		waxApiCaller: BRAND.APP_ID,
		...(chainId ? { chainId } : {}),
	}
}

async function createChainAt(
	apiEndpoint: string,
	chainId?: string
): Promise<IHiveChainInterface> {
	return await createHiveChain(sharedChainOptions(apiEndpoint, chainId))
}

async function findBestBackup(
	backups: readonly string[]
): Promise<string> {
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
 * Creates a Hive chain with hybrid failover.
 * Tries the default API first, then HealthChecker, then sequential backups.
 */
export async function createFreshChain(
	mode?: HiveNetworkMode
): Promise<IHiveChainInterface> {
	if (!shouldUseMainnet(mode)) {
		return await createChainAt(
			HIVE_CHAIN_CONFIG.TESTNET_API,
			HIVE_CHAIN_CONFIG.TESTNET_CHAIN_ID
		)
	}

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
