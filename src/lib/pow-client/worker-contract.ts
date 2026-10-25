export type PowWorkerRequest =
  | {
      readonly type: 'solve'
      readonly jobId: string
      readonly prefix: string
      readonly difficulty: number
      readonly remainingMs: number
    }
  | { readonly type: 'cancel'; readonly jobId: string }

export type PowWorkerResponse =
  | {
      readonly type: 'solved'
      readonly jobId: string
      readonly nonce: string
    }
  | {
      readonly type: 'failed'
      readonly jobId: string
      readonly reason: 'expired' | 'cancelled' | 'busy' | 'invalid_request'
    }

export function isPowWorkerResponse(
  value: unknown
): value is PowWorkerResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const message = value as Record<string, unknown>
  if (typeof message.jobId !== 'string' || message.jobId.length === 0) {
    return false
  }

  if (message.type === 'solved') {
    return (
      typeof message.nonce === 'string' &&
      /^[0-9a-f]{1,16}$/u.test(message.nonce)
    )
  }

  return (
    message.type === 'failed' &&
    (message.reason === 'expired' ||
      message.reason === 'cancelled' ||
      message.reason === 'busy' ||
      message.reason === 'invalid_request')
  )
}

export function isPowWorkerRequest(value: unknown): value is PowWorkerRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const message = value as Record<string, unknown>
  if (typeof message.jobId !== 'string' || message.jobId.length === 0) {
    return false
  }

  if (message.type === 'cancel') return true

  return (
    message.type === 'solve' &&
    typeof message.prefix === 'string' &&
    message.prefix.length > 0 &&
    typeof message.difficulty === 'number' &&
    Number.isInteger(message.difficulty) &&
    message.difficulty >= 1 &&
    message.difficulty <= 256 &&
    typeof message.remainingMs === 'number' &&
    Number.isFinite(message.remainingMs) &&
    message.remainingMs > 0
  )
}
