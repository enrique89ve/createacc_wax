/**
 * Hive Signature Verifier - Cryptographic verification of Keychain signatures
 * Validates that the signature corresponds to the specific message and user
 */

import { hiveChain } from '@/lib/hiveservice'
import type { IHiveChainInterface } from '@hiveio/wax'
import { getWaxFoundation } from '@/lib/wax-foundation'
import { createHash } from 'node:crypto'
import type {
  HiveSignatureVerificationRequest,
  HiveSignatureVerificationResult,
  HiveUsername,
  HivePublicKey,
  HiveSignatureErrorCode,
} from '@/types/hive-signature'
import { createHiveUsername, createHivePublicKey } from '@/types/hive-signature'

export type SignatureVerificationParams = HiveSignatureVerificationRequest
export type SignatureVerificationResult = HiveSignatureVerificationResult

type PostingKeyAuth = readonly [string, number]

interface AccountLookupResult {
  readonly found: boolean
  readonly postingKeyAuths: readonly PostingKeyAuth[]
  readonly error?: string
}

export class HiveSignatureVerifier {
  private createErrorResult(
    code: HiveSignatureErrorCode,
    message: string
  ): HiveSignatureVerificationResult {
    return {
      valid: false,
      error: `[${code}] ${message}`,
    }
  }

  async verifyMessageSignature(
    params: HiveSignatureVerificationRequest
  ): Promise<HiveSignatureVerificationResult> {
    const { username, message, publicKey, signature } = params

    try {
      if (!username || !message) {
        return this.createErrorResult(
          'INVALID_USERNAME',
          'Username and message are required'
        )
      }

      if (!signature || signature.length < 128 || signature.length > 140) {
        return this.createErrorResult(
          'INVALID_SIGNATURE',
          'Signature required for cryptographic verification'
        )
      }

      if (!publicKey) {
        return this.createErrorResult(
          'INVALID_SIGNATURE',
          'PublicKey is required for verification'
        )
      }

      const hiveUsername = createHiveUsername(username)
      const hivePublicKey = createHivePublicKey(publicKey)

      // Verify that the user exists and get their posting keys
      const chain = await hiveChain()
      const accountResult = await this.lookupPostingKeys(hiveUsername, chain)

      if (!accountResult.found) {
        return {
          valid: false,
          error: accountResult.error || 'User not found on Hive blockchain',
        }
      }

      // Verify that the publicKey belongs to the user (posting authority)
      const { postingKeyAuths } = accountResult
      const publicKeyInAuthorities = postingKeyAuths.find(
        ([key]) => key === hivePublicKey
      )
      if (!publicKeyInAuthorities) {
        return this.createErrorResult(
          'SIGNATURE_VERIFICATION_FAILED',
          'The provided public key does not belong to the user'
        )
      }

      // Cryptographic verification: recover public key from signature and compare
      return await this.verifySignatureCryptographically(
        message,
        signature,
        hivePublicKey,
        postingKeyAuths
      )
    } catch (error) {
      return {
        valid: false,
        error: `Verification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  }

  /**
   * Recovers the public key from the signature and verifies that it belongs to the user.
   * Keychain signs a SHA-256 of the challenge message.
   */
  private async verifySignatureCryptographically(
    message: string,
    signature: string,
    hivePublicKey: HivePublicKey,
    postingKeyAuths: readonly PostingKeyAuth[]
  ): Promise<HiveSignatureVerificationResult> {
    const wax = await getWaxFoundation()

    const sigDigest = createHash('sha256').update(message).digest('hex')
    const recoveredKey = wax.getPublicKeyFromSignature(sigDigest, signature)

    // Verify that the recovered key is in the user's posting key_auths
    const keyInAuthorities = postingKeyAuths.find(
      ([key]) => key === recoveredKey
    )

    if (!keyInAuthorities) {
      return this.createErrorResult(
        'SIGNATURE_VERIFICATION_FAILED',
        'The signature does not correspond to any posting key of the user'
      )
    }

    // Anti-injection: the key sent by the client must match the recovered one
    if (recoveredKey !== hivePublicKey) {
      return this.createErrorResult(
        'PUBLIC_KEY_MISMATCH',
        'The public key sent does not match the key that generated the signature'
      )
    }

    return { valid: true }
  }

  /**
   * Searches for the account on Hive and extracts the posting key_auths directly from the API response.
   * Avoids casting the entire ApiAccount to custom types.
   */
  private async lookupPostingKeys(
    username: HiveUsername,
    chain: IHiveChainInterface
  ): Promise<AccountLookupResult> {
    try {
      const response = await chain.api.database_api.find_accounts({
        accounts: [username],
        delayed_votes_active: true,
      })

      if (response.accounts.length === 0) {
        return {
          found: false,
          postingKeyAuths: [],
          error: `Account ${username} not found on Hive blockchain`,
        }
      }

      const account = response.accounts[0]

      return {
        found: true,
        postingKeyAuths: account.posting
          .key_auths as unknown as PostingKeyAuth[],
      }
    } catch (error) {
      return {
        found: false,
        postingKeyAuths: [],
        error: `Error verifying account: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    }
  }
}

export const hiveSignatureVerifier = new HiveSignatureVerifier()

export async function quickVerifySignature(
  params: HiveSignatureVerificationRequest
): Promise<HiveSignatureVerificationResult> {
  return hiveSignatureVerifier.verifyMessageSignature(params)
}
