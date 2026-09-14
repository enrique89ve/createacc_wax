import {
	ResourceCreditsOperation,
	type IOnlineTransaction,
	type TAccountName,
	type TNaiAssetConvertible,
} from '@hiveio/wax'
import { createDelegatorService } from '@/lib/hive-transaction-service'
import { AppError, AppErrorCode } from '@/consts/errors'
import { getRequiredEnvString } from '@/lib/env'
import { ENV_KEYS } from '@/consts/constants'
import { isSimulationMode } from '@/lib/hive-execution-mode'
import type { HiveTransactionResult } from '@/types/hive-transaction'
import { logger } from '@/lib/logger'

export interface IDelegateRCParams {
	readonly maxRc: TNaiAssetConvertible
	readonly delegatee: TAccountName
}

export interface IRemoveDelegationParams {
	readonly delegatee: TAccountName
}

function assertNotSelfDelegation(delegator: string, delegatee: string): void {
	if (delegator && delegatee && delegator === delegatee) {
		throw new AppError(AppErrorCode.SELF_DELEGATION)
	}
}

function assertNotSelfRemoval(delegator: string, delegatee: string): void {
	if (delegator && delegatee && delegator === delegatee) {
		throw new AppError(AppErrorCode.SELF_REMOVAL)
	}
}

function pushDelegateRcOperation(
	tx: IOnlineTransaction,
	delegatorAccount: string,
	params: IDelegateRCParams
): void {
	const rcOperation = new ResourceCreditsOperation()
	rcOperation
		.delegate(delegatorAccount, params.maxRc, params.delegatee)
		.authorize(delegatorAccount)
	tx.pushOperation(rcOperation)
}

export async function delegateResourceCredits(
	params: IDelegateRCParams
): Promise<HiveTransactionResult> {
	const service = createDelegatorService()
	const delegatorAccount = getRequiredEnvString(ENV_KEYS.HIVE_DELEGATOR_ACCOUNT)

	try {
		assertNotSelfDelegation(delegatorAccount, params.delegatee)
	} catch {
		throw new AppError(AppErrorCode.SELF_DELEGATION)
	}

	return await service.executeTransaction(
		(tx, account) => {
			pushDelegateRcOperation(tx, account, params)
		},
		{ skipOnChainVerification: isSimulationMode() }
	)
}

/**
 * Validates the RC delegation builder and signs through the same
 * HiveTransactionService / broadcast gateway. In simulation the
 * delegatee does not exist on Hive, so on-chain verification is skipped
 * and broadcast remains disabled.
 */
export async function simulateRcDelegation(
	username: string,
	maxRc: TNaiAssetConvertible
): Promise<HiveTransactionResult | null> {
	try {
		const result = await delegateResourceCredits({
			delegatee: username,
			maxRc,
		})
		logger.info(
			`[rc-delegation] Simulated RC builder for ${username} wax=${result.wax.validated ? 'passed' : 'failed'} signed=${result.wax.signed} broadcast=${result.broadcasted}`
		)
		return result
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : 'Unknown error'
		logger.warn(`[rc-delegation] Simulation skipped for ${username}: ${errMsg}`)
		return null
	}
}

export async function removeDelegation(
	params: IRemoveDelegationParams
): Promise<HiveTransactionResult> {
	const service = createDelegatorService()
	const delegatorAccount = getRequiredEnvString(ENV_KEYS.HIVE_DELEGATOR_ACCOUNT)

	try {
		assertNotSelfRemoval(delegatorAccount, params.delegatee)
	} catch {
		throw new AppError(AppErrorCode.SELF_REMOVAL)
	}

	return await service.executeTransaction(
		(tx, account) => {
			const rcOperation = new ResourceCreditsOperation()
			rcOperation.removeDelegation(account, params.delegatee)
			rcOperation.authorize(account)
			tx.pushOperation(rcOperation)
		},
		{ skipOnChainVerification: isSimulationMode() }
	)
}
