import { randomBytes } from 'node:crypto'
import { execute, withTransaction } from '@/lib/database'
import { claimCredits } from '@/lib/credits/core'
import type { VerifiedHiveClaim } from '@/lib/credits/adapters/hive-claim-adapter'

export const CLAIM_INTENT_TTL_MS = 10 * 60 * 1000

const CLAIM_SERVICE_ERRORS = {
  INVALID_INPUT: 'invalid_input',
  NO_PENDING: 'no_pending',
  INTENT_NOT_FOUND: 'intent_not_found',
  INSUFFICIENT_PENDING: 'insufficient_pending',
  DUPLICATE_REFERENCE: 'duplicate_reference',
  INTERNAL: 'internal',
} as const

type ClaimServiceErrorCode =
  (typeof CLAIM_SERVICE_ERRORS)[keyof typeof CLAIM_SERVICE_ERRORS]

type ClaimServiceFailure = {
  readonly ok: false
  readonly code: ClaimServiceErrorCode
  readonly error: string
}

export type ClaimIntent = {
  readonly hash: string
  readonly hiveUsername: string
  readonly amount: number
  readonly createdAt: number
  readonly expiresAt: number
}

export type CreateClaimIntentResult =
  | { readonly ok: true; readonly intent: ClaimIntent }
  | ClaimServiceFailure

export type CompleteClaimResult =
  | {
      readonly ok: true
      readonly credits: number
      readonly available: number
      readonly pending: number
      readonly newBalance: number
    }
  | ClaimServiceFailure

type ClaimIntentOptions = {
  readonly now?: number
  readonly hashFactory?: () => string
}

const DEFAULT_HASH_FACTORY = (): string => randomBytes(32).toString('hex')

function failure(
  code: ClaimServiceErrorCode,
  error: string
): ClaimServiceFailure {
  return { ok: false, code, error }
}

function parsePositiveInteger(value: unknown): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function isValidUsername(username: string): boolean {
  return username.trim().length > 0
}

function isValidHash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash)
}

function isValidClaimProof(proof: VerifiedHiveClaim): boolean {
  if (!isValidUsername(proof.username) || !isValidHash(proof.hash)) return false
  if (!/^[a-f0-9]{8,128}$/.test(proof.transactionId)) return false
  if (!Number.isSafeInteger(proof.operationIndex) || proof.operationIndex < 0) {
    return false
  }
  return (
    proof.externalReference ===
    `hive:claim:${proof.transactionId}:${proof.operationIndex}`
  )
}

function classifyCompletionError(error: unknown): ClaimServiceFailure {
  const message = error instanceof Error ? error.message : ''
  if (message === CLAIM_SERVICE_ERRORS.INTENT_NOT_FOUND) {
    return failure(
      CLAIM_SERVICE_ERRORS.INTENT_NOT_FOUND,
      'Claim intent not found, expired, or already consumed'
    )
  }
  if (message === CLAIM_SERVICE_ERRORS.INSUFFICIENT_PENDING) {
    return failure(
      CLAIM_SERVICE_ERRORS.INSUFFICIENT_PENDING,
      'Insufficient pending credits'
    )
  }
  if (message === 'Insufficient pending credits') {
    return failure(
      CLAIM_SERVICE_ERRORS.INSUFFICIENT_PENDING,
      'Insufficient pending credits'
    )
  }
  if (
    message === CLAIM_SERVICE_ERRORS.DUPLICATE_REFERENCE ||
    message.includes('UNIQUE constraint failed: CreditAudit.external_reference')
  ) {
    return failure(
      CLAIM_SERVICE_ERRORS.DUPLICATE_REFERENCE,
      'Claim transaction has already been applied'
    )
  }
  return failure(
    CLAIM_SERVICE_ERRORS.INTERNAL,
    'Unable to complete credit claim'
  )
}

export async function createClaimIntent(
  hiveUsername: string,
  options: ClaimIntentOptions = {}
): Promise<CreateClaimIntentResult> {
  const username = hiveUsername.trim()
  if (!isValidUsername(username)) {
    return failure(CLAIM_SERVICE_ERRORS.INVALID_INPUT, 'Invalid Hive username')
  }

  const now = options.now ?? Date.now()
  const expiresAt = now + CLAIM_INTENT_TTL_MS
  const hash = (options.hashFactory ?? DEFAULT_HASH_FACTORY)().toLowerCase()
  if (!isValidHash(hash)) {
    return failure(CLAIM_SERVICE_ERRORS.INVALID_INPUT, 'Invalid claim hash')
  }

  return withTransaction(async () => {
    await execute({
      sql: 'DELETE FROM CreditClaimIntents WHERE expires_at <= ?',
      args: [now],
    })

    const pendingResult = await execute({
      sql: `SELECT pending_amount FROM Credits
        WHERE hive_username = ? AND pending_amount > 0
        LIMIT 1`,
      args: [username],
    })
    const pendingAmount = parsePositiveInteger(
      (pendingResult.rows[0] as Record<string, unknown> | undefined)
        ?.pending_amount
    )
    if (pendingAmount === null) {
      return failure(
        CLAIM_SERVICE_ERRORS.NO_PENDING,
        'No pending credits available for claim'
      )
    }

    await execute({
      sql: `INSERT INTO CreditClaimIntents
        (hash, hive_username, amount, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?)`,
      args: [hash, username, pendingAmount, now, expiresAt],
    })

    return {
      ok: true,
      intent: {
        hash,
        hiveUsername: username,
        amount: pendingAmount,
        createdAt: now,
        expiresAt,
      },
    }
  })
}

export async function completeClaim(
  proof: VerifiedHiveClaim,
  now: number = Date.now()
): Promise<CompleteClaimResult> {
  if (!isValidClaimProof(proof)) {
    return failure(CLAIM_SERVICE_ERRORS.INVALID_INPUT, 'Invalid verified claim')
  }

  try {
    return await withTransaction(async () => {
      const intentResult = await execute({
        sql: `DELETE FROM CreditClaimIntents
          WHERE hash = ? AND hive_username = ? AND expires_at > ?
          RETURNING amount`,
        args: [proof.hash, proof.username, now],
      })
      if (intentResult.rows.length !== 1) {
        throw new Error(CLAIM_SERVICE_ERRORS.INTENT_NOT_FOUND)
      }

      const amount = parsePositiveInteger(
        (intentResult.rows[0] as Record<string, unknown>).amount
      )
      if (amount === null) {
        throw new Error(CLAIM_SERVICE_ERRORS.INTERNAL)
      }

      const existingReference = await execute({
        sql: 'SELECT 1 FROM CreditAudit WHERE external_reference = ? LIMIT 1',
        args: [proof.externalReference],
      })
      if (existingReference.rows.length > 0) {
        throw new Error(CLAIM_SERVICE_ERRORS.DUPLICATE_REFERENCE)
      }

      await claimCredits(proof.username, amount, {
        externalReference: proof.externalReference,
      })

      const balanceResult = await execute({
        sql: `SELECT pending_amount, available_amount FROM Credits
          WHERE hive_username = ?`,
        args: [proof.username],
      })
      if (balanceResult.rows.length !== 1) {
        throw new Error(CLAIM_SERVICE_ERRORS.INTERNAL)
      }

      const balance = balanceResult.rows[0] as Record<string, unknown>
      const pending = Number(balance.pending_amount)
      const available = Number(balance.available_amount)
      if (!Number.isSafeInteger(pending) || !Number.isSafeInteger(available)) {
        throw new Error(CLAIM_SERVICE_ERRORS.INTERNAL)
      }

      return {
        ok: true,
        credits: amount,
        available,
        pending,
        newBalance: available,
      }
    })
  } catch (error) {
    return classifyCompletionError(error)
  }
}

export { CLAIM_SERVICE_ERRORS }
