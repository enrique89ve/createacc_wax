/**
 * 🔍 HIVE TRANSACTION VERIFIER
 *
 * Utilities to verify custom JSON transactions on the Hive blockchain
 */

import { type TWaxRestExtended } from '@hiveio/wax'
import { BRAND } from '@/consts/branding'
import { hiveChain } from '@/lib/hiveservice'

interface ITransactionByIdRequest {
  transactionId: string
}

// Real structure of Wax response
interface IHiveTransaction {
  transaction_id: string
  block_num: number
  transaction_num: number
  timestamp: string
  transaction_json: {
    expiration: string
    extensions: unknown[]
    operations: Array<{
      type: string
      value: {
        id: string
        json: string
        required_auths: string[]
        required_posting_auths: string[]
      }
    }>
    signatures: string[]
    ref_block_num: number
    ref_block_prefix: number
  }
}

// Create extended API structure
type TExtendedRestApi = {
  'hafah-api': {
    transactions: {
      byId: {
        params: ITransactionByIdRequest
        result: IHiveTransaction
      }
    }
  }
}

export interface ClaimVerificationResult {
  valid: boolean
  error?: string
  transaction?: IHiveTransaction
  customJson?: {
    app: string
    hash: string
    username: string
    timestamp: number
    action: string
  }
}

/**
 * Verifies a custom JSON transaction for claim operations
 */
export async function verifyClaimTransaction(
  transactionId: string,
  expectedHash: string,
  expectedUsername: string
): Promise<ClaimVerificationResult> {
  try {
    const chain = await hiveChain()

    // Extend REST API to include hafah-api
    const extended: TWaxRestExtended<TExtendedRestApi> = chain.extendRest({
      'hafah-api': {
        transactions: {
          byId: {
            urlPath: '{transactionId}',
          },
        },
      },
    })

    // Get transaction by ID
    const transaction = await extended.restApi['hafah-api'].transactions.byId({
      transactionId,
    })

    if (!transaction) {
      return {
        valid: false,
        error: 'Transaction not found on the blockchain',
      }
    }

    // Find custom_json operation with id 'claim_credits'
    const customJsonOp = transaction.transaction_json.operations?.find(
      op =>
        op.type === 'custom_json_operation' && op.value.id === 'claim_credits'
    )
    if (!customJsonOp) {
      return {
        valid: false,
        error: 'No claim_credits operation found in the transaction',
      }
    }

    // Access operation data
    const opData = customJsonOp.value

    // Verify that the user has posting authorization
    const requiredPostingAuths = opData.required_posting_auths || []
    if (!requiredPostingAuths.includes(expectedUsername)) {
      return {
        valid: false,
        error: 'The user does not have posting authorization in the transaction',
        transaction,
      }
    }

    // Parse the operation JSON
    let customJsonData
    try {
      customJsonData = JSON.parse(opData.json)
    } catch (parseError) {
      return {
        valid: false,
        error: 'Invalid operation JSON',
      }
    }

    // Verify custom JSON structure
    if (!customJsonData.app || customJsonData.app !== BRAND.CLAIM_APP_ID) {
      return {
        valid: false,
        error: 'Incorrect app identifier in custom JSON',
      }
    }

    if (!customJsonData.hash || customJsonData.hash !== expectedHash) {
      return {
        valid: false,
        error: 'Validation hash does not match',
      }
    }

    if (
      !customJsonData.username ||
      customJsonData.username !== expectedUsername
    ) {
      return {
        valid: false,
        error: 'Username in custom JSON does not match',
      }
    }

    if (customJsonData.action !== 'claim_credits') {
      return {
        valid: false,
        error: 'Incorrect action in custom JSON',
      }
    }

    // Verify that the transaction is not too old (maximum 30 minutes)
    const transactionTime = new Date(transaction.timestamp).getTime()
    const now = Date.now()
    const maxAge = 30 * 60 * 1000 // 30 minutes

    if (now - transactionTime > maxAge) {
      return {
        valid: false,
        error: 'The transaction is too old to be valid',
      }
    }

    return {
      valid: true,
      transaction,
      customJson: customJsonData,
    }
  } catch (error) {
    return {
      valid: false,
      error: `Error verifying transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

/**
 * Cleans up expired hashes from the database
 */
export async function cleanupExpiredHashes(): Promise<void> {
  try {
    const { db } = await import('./database')

    await db.execute({
      sql: `DELETE FROM TempClaimHashes
			      WHERE expires_at < datetime('now') AND used = FALSE`,
      args: [],
    })
  } catch (error) {
    // Silently handle cleanup errors
  }
}
