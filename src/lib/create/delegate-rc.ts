import {
  ResourceCreditsOperation,
  type TAccountName,
  type TNaiAssetConvertible,
} from '@hiveio/wax'
import { createDelegatorService } from '@/lib/hive-transaction-service'
import { AppError, AppErrorCode } from '@/consts/errors'
import { getRequiredEnvString } from '@/lib/env'
import { ENV_KEYS } from '@/consts/constants'

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

export async function delegateResourceCredits(
  params: IDelegateRCParams
): Promise<{ id: string }> {
  const service = createDelegatorService()

  // Validation centralizada
  const delegatorAccount = getRequiredEnvString(ENV_KEYS.HIVE_DELEGATOR_ACCOUNT)
  try {
    assertNotSelfDelegation(delegatorAccount, params.delegatee)
  } catch (_error) {
    // Re-throw as typed AppError for consistent error handling
    throw new AppError(AppErrorCode.SELF_DELEGATION)
  }

  return await service.executeTransaction((tx, delegatorAccount) => {
    const rcOperation = new ResourceCreditsOperation()
    rcOperation
      .delegate(delegatorAccount, params.maxRc.toString(), params.delegatee)
      .authorize(delegatorAccount)
    tx.pushOperation(rcOperation)
  })
}

export async function removeDelegation(
  params: IRemoveDelegationParams
): Promise<{ id: string }> {
  const service = createDelegatorService()

  // Validation centralizada
  const delegatorAccount = getRequiredEnvString(ENV_KEYS.HIVE_DELEGATOR_ACCOUNT)
  try {
    assertNotSelfRemoval(delegatorAccount, params.delegatee)
  } catch (_error) {
    // Re-throw as typed AppError for consistent error handling
    throw new AppError(AppErrorCode.SELF_REMOVAL)
  }

  return await service.executeTransaction((tx, delegatorAccount) => {
    const rcOperation = new ResourceCreditsOperation()
    rcOperation.removeDelegation(delegatorAccount, params.delegatee)
    rcOperation.authorize(delegatorAccount)
    tx.pushOperation(rcOperation)
  })
}
