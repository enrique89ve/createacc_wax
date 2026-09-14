import { EManabarType } from '@hiveio/wax'
import { ENV_KEYS } from '@/consts/constants'
import { getRequiredEnvString } from '@/lib/env'
import { hiveChain } from '@/lib/hiveservice'
import {
	getHiveExecutionMode,
	isBroadcastEnabled,
} from '@/lib/hive-execution-mode'
import type { HiveExecutionMode } from '@/consts/hive-execution'
import { HiveKeys } from '@/lib/create/get-keys'
import { createAccount } from '@/lib/create/create-account'
import { noopHiveBroadcast } from '@/lib/hive-broadcaster'
import type { HiveTransactionRuntime } from '@/lib/hive-transaction-service'

export interface WaxDiagnostics {
	readonly waxVersion: string
	readonly hive: {
		readonly connected: boolean
		readonly endpoint: string
	}
	readonly creator: {
		readonly exists: boolean
		readonly claimedAccounts: number
		readonly rcPercent?: number
	}
	readonly transaction: {
		readonly created: boolean
		readonly validated: boolean
		readonly onChainVerified: boolean
		readonly signed: boolean
		readonly authorityVerified: boolean
		readonly broadcasted: boolean
	}
	readonly broadcast: {
		readonly mode: HiveExecutionMode
		readonly allowed: boolean
		readonly injectedNoop: boolean
	}
}

function randomSimUsername(): string {
	const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
	return `hhsim${suffix}`
}

const SELF_TEST_RUNTIME: HiveTransactionRuntime = {
	broadcast: noopHiveBroadcast,
}

export async function collectWaxDiagnostics(
	runtime: HiveTransactionRuntime = SELF_TEST_RUNTIME
): Promise<WaxDiagnostics> {
	const creator = getRequiredEnvString(ENV_KEYS.HIVE_CREATOR_ACCOUNT)
	const chain = await hiveChain()
	const accounts = await chain.api.database_api.find_accounts({
		accounts: [creator],
		delayed_votes_active: true,
	})
	const creatorAccount = accounts.accounts[0]
	let rcPercent: number | undefined
	try {
		rcPercent = (await chain.calculateCurrentManabarValueForAccount(
			creator,
			EManabarType.RC
		)).percent
	} catch {
		rcPercent = undefined
	}

	const username = randomSimUsername()
	const keys = await HiveKeys.generate(username)
	const tx = await createAccount(keys.toCreateAccountParams(username), runtime)

	return {
		waxVersion: '2.0.2',
		hive: {
			connected: true,
			endpoint: chain.endpointUrl,
		},
		creator: {
			exists: Boolean(creatorAccount),
			claimedAccounts: creatorAccount
				? Number(creatorAccount.pending_claimed_accounts)
				: 0,
			rcPercent,
		},
		transaction: {
			created: true,
			validated: tx.wax.validated,
			onChainVerified: tx.wax.onChainVerified,
			signed: tx.wax.signed,
			authorityVerified: tx.wax.authorityVerified,
			broadcasted: tx.broadcasted,
		},
		broadcast: {
			mode: getHiveExecutionMode(),
			allowed: isBroadcastEnabled(),
			injectedNoop: runtime.broadcast === noopHiveBroadcast,
		},
	}
}
