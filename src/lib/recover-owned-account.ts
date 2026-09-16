import {
	findOpenCreationAttempt,
	getCreationAttempt,
	hiveTransactionFromAttempt,
	type CreationAttempt,
	type CreationAttemptKeys,
} from '@/lib/creation-attempts'
import {
	fetchHiveAccountAuthorities,
	hiveAuthoritiesMatchExpected,
} from '@/lib/hive-account-authorities'
import type { HiveTransactionResult } from '@/types/hive-transaction'
import type { IHiveChainInterface } from '@hiveio/wax'

export type RecoverOwnedAccountResult =
	| {
			readonly kind: 'recovered'
			readonly attempt: CreationAttempt
			readonly tx: HiveTransactionResult | null
	  }
	| { readonly kind: 'foreign_account'; readonly attempt: CreationAttempt }
	| { readonly kind: 'not_found' }
	| { readonly kind: 'ambiguous' }
	| { readonly kind: 'no_attempt' }
	| { readonly kind: 'error'; readonly message: string }

export async function loadAttemptForRecovery(params: {
	readonly username: string
	readonly ticket: string
	readonly keys: CreationAttemptKeys
	readonly correlationId?: string
}): Promise<CreationAttempt | null> {
	if (params.correlationId) {
		const byId = await getCreationAttempt(params.correlationId)
		if (byId) return byId
	}
	return findOpenCreationAttempt({
		username: params.username,
		ticket: params.ticket,
		keys: params.keys,
	})
}

export async function recoverOwnedAccount(
	params: {
		readonly username: string
		readonly ticket: string
		readonly keys: CreationAttemptKeys
		readonly correlationId?: string
	},
	chain?: IHiveChainInterface
): Promise<RecoverOwnedAccountResult> {
	const attempt = await loadAttemptForRecovery(params)
	if (!attempt) return { kind: 'no_attempt' }

	const lookup = await fetchHiveAccountAuthorities(params.username, chain)
	if (lookup.status === 'error') {
		return { kind: 'error', message: lookup.message }
	}
	if (lookup.status === 'not_found') return { kind: 'not_found' }
	if (lookup.status === 'ambiguous') return { kind: 'ambiguous' }

	if (!hiveAuthoritiesMatchExpected(lookup.authorities, params.keys)) {
		return { kind: 'foreign_account', attempt }
	}

	return {
		kind: 'recovered',
		attempt,
		tx: hiveTransactionFromAttempt(attempt),
	}
}
