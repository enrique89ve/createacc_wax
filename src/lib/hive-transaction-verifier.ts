/**
 * Compatibility facade for the Credits claim verifier.
 * New code should use the normalized Hive claim adapter directly.
 */

import {
  verifyHiveClaim,
  type HiveClaimVerificationInput,
} from '@/lib/credits/adapters/hive-claim-adapter'

export interface ClaimVerificationResult {
  readonly valid: boolean
  readonly error?: string
  readonly operationIndex?: number
  readonly externalReference?: string
}

export async function verifyClaimTransaction(
  transactionId: string,
  expectedHash: string,
  expectedUsername: string
): Promise<ClaimVerificationResult> {
  const input: HiveClaimVerificationInput = {
    transactionId,
    hash: expectedHash,
    username: expectedUsername,
  }
  const result = await verifyHiveClaim(input)

  if (!result.ok) {
    return { valid: false, error: result.error }
  }

  return {
    valid: true,
    operationIndex: result.claim.operationIndex,
    externalReference: result.claim.externalReference,
  }
}
