export type ClaimVerificationAttempt = {
  readonly status: number
  readonly body: unknown
}

export type ClaimVerificationFetcher = (
  transactionId: string,
  hash: string
) => Promise<ClaimVerificationAttempt>

export type ClaimVerificationPollingOptions = {
  readonly initialDelayMs?: number
  readonly retryDelayMs?: number
  readonly maxRetryDelayMs?: number
  readonly maxAttempts?: number
  readonly sleep?: (milliseconds: number) => Promise<void>
}

export const CLAIM_VERIFICATION_POLLING = {
  INITIAL_DELAY_MS: 1000,
  RETRY_DELAY_MS: 1000,
  MAX_RETRY_DELAY_MS: 4000,
  MAX_ATTEMPTS: 6,
} as const

const sleep = (milliseconds: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, milliseconds))

function isRetryableStatus(status: number): boolean {
  return status === 202 || status === 503
}

export async function pollClaimVerification(
  transactionId: string,
  hash: string,
  fetchVerification: ClaimVerificationFetcher,
  options: ClaimVerificationPollingOptions = {}
): Promise<ClaimVerificationAttempt> {
  const initialDelayMs =
    options.initialDelayMs ?? CLAIM_VERIFICATION_POLLING.INITIAL_DELAY_MS
  const retryDelayMs =
    options.retryDelayMs ?? CLAIM_VERIFICATION_POLLING.RETRY_DELAY_MS
  const maxRetryDelayMs =
    options.maxRetryDelayMs ?? CLAIM_VERIFICATION_POLLING.MAX_RETRY_DELAY_MS
  const maxAttempts =
    options.maxAttempts ?? CLAIM_VERIFICATION_POLLING.MAX_ATTEMPTS
  const sleepFn = options.sleep ?? sleep

  await sleepFn(initialDelayMs)

  let delayMs = retryDelayMs
  let lastError: unknown = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetchVerification(transactionId, hash)
      if (!isRetryableStatus(response.status) || attempt === maxAttempts - 1) {
        return response
      }
      lastError = null
    } catch (error) {
      lastError = error
      if (attempt === maxAttempts - 1) {
        throw new Error('Claim verification unavailable after retries', {
          cause: error,
        })
      }
    }

    await sleepFn(delayMs)
    delayMs = Math.min(delayMs * 2, maxRetryDelayMs)
  }

  throw new Error('Claim verification ended without a response', {
    cause: lastError,
  })
}
