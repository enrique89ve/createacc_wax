import type { HiveChain } from '@/lib/hive-chain-factory'
import { createFreshChain } from '@/lib/hive-chain-factory'

export type { HiveChain }

let cachedChain: HiveChain | null = null
let creatingChainPromise: Promise<HiveChain | null> | null = null

export async function getHiveChain(): Promise<HiveChain | null> {
  if (cachedChain) return cachedChain
  if (creatingChainPromise) return creatingChainPromise

  creatingChainPromise = (async () => {
    try {
      const chain = await createFreshChain()
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
