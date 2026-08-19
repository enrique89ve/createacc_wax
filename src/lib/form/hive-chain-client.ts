import type { HiveChain, HiveNetworkMode } from '@/lib/hive-chain-factory'
import { createFreshChain } from '@/lib/hive-chain-factory'

export type { HiveChain }

const HIVE_NETWORK_FORM_ID = 'formulario'
const HIVE_NETWORK_ATTR = 'data-hive-network'

let cachedChain: HiveChain | null = null
let creatingChainPromise: Promise<HiveChain | null> | null = null

function resolveClientNetwork(): HiveNetworkMode {
	if (typeof document === 'undefined') return 'mainnet'
	const marked = document.getElementById(HIVE_NETWORK_FORM_ID)
	const value = marked?.getAttribute(HIVE_NETWORK_ATTR)
	return value === 'testnet' ? 'testnet' : 'mainnet'
}

export async function getHiveChain(): Promise<HiveChain | null> {
	if (cachedChain) return cachedChain
	if (creatingChainPromise) return creatingChainPromise

	creatingChainPromise = (async () => {
		try {
			const chain = await createFreshChain(resolveClientNetwork())
			cachedChain = chain
			return chain
		} catch {
			return null
		} finally {
			creatingChainPromise = null
		}
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
