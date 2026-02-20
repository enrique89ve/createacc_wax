import type { create_claimed_account } from '@hiveio/wax'
import { createCreatorService } from '@/lib/hive-transaction-service'
import { BRAND } from '@/consts/branding'

export interface ICreateAccountParams {
  readonly username: string
  readonly ownerPublicKey: string
  readonly activePublicKey: string
  readonly postingPublicKey: string
  readonly memoPublicKey: string
}

export async function createAccount(
  params: ICreateAccountParams
): Promise<{ id: string }> {
  const service = createCreatorService()

  return await service.executeTransaction((tx, creatorAccount) => {
    const operation: create_claimed_account = {
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

    tx.pushOperation({
      create_claimed_account_operation: operation,
    })
  })
}
