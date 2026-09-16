import type { create_claimed_account as CreateClaimedAccount, IOnlineTransaction } from '@hiveio/wax'
import {
	createCreatorService,
	type HiveTransactionRuntime,
	type PreparedTransactionSnapshot,
} from '@/lib/hive-transaction-service'
import { BRAND } from '@/consts/branding'
import type { HiveTransactionResult } from '@/types/hive-transaction'
import type { PublicKeySet } from '@/types/keys'

export type ICreateAccountParams = PublicKeySet & {
	readonly username: string
}

export function buildCreateClaimedAccountOperation(
	params: ICreateAccountParams,
	creatorAccount: string
): CreateClaimedAccount {
	return {
		creator: creatorAccount,
		new_account_name: params.username,
		owner: {
			weight_threshold: 1,
			account_auths: {},
			key_auths: { [params.ownerPublicKey]: 1 },
		},
		active: {
			weight_threshold: 1,
			account_auths: {},
			key_auths: { [params.activePublicKey]: 1 },
		},
		posting: {
			weight_threshold: 1,
			account_auths: {},
			key_auths: { [params.postingPublicKey]: 1 },
		},
		memo_key: params.memoPublicKey,
		json_metadata: JSON.stringify({
			app: BRAND.APP_ID,
			ticket: '',
		}),
		extensions: [],
	}
}

export function pushCreateClaimedAccount(
	tx: IOnlineTransaction,
	params: ICreateAccountParams,
	creatorAccount: string
): void {
	tx.pushOperation({
		create_claimed_account_operation: buildCreateClaimedAccountOperation(
			params,
			creatorAccount
		),
	})
}

export async function createAccount(
	params: ICreateAccountParams,
	runtime?: HiveTransactionRuntime,
	onPrepared?: (snapshot: PreparedTransactionSnapshot) => Promise<void>
): Promise<HiveTransactionResult> {
	const service = createCreatorService(runtime)

	return await service.executeTransaction(
		(tx, creatorAccount) => {
			pushCreateClaimedAccount(tx, params, creatorAccount)
		},
		{ onPrepared }
	)
}
