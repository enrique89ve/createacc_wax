import { describe, expect, it } from 'vitest'
import {
  pollClaimVerification,
  type ClaimVerificationAttempt,
} from '@/lib/credits/claim-polling'

const TRANSACTION_ID = 'b'.repeat(64)
const HASH = 'a'.repeat(64)

function response(status: number): ClaimVerificationAttempt {
  return { status, body: { success: status === 200 } }
}

describe('claim verification polling', () => {
  it('waits one second before the first verification request', async () => {
    const sleeps: number[] = []
    const requests: Array<[string, string]> = []

    const result = await pollClaimVerification(
      TRANSACTION_ID,
      HASH,
      async (transactionId, hash) => {
        requests.push([transactionId, hash])
        return response(200)
      },
      {
        sleep: async milliseconds => {
          sleeps.push(milliseconds)
        },
      }
    )

    expect(result.status).toBe(200)
    expect(requests).toEqual([[TRANSACTION_ID, HASH]])
    expect(sleeps).toEqual([1000])
  })

  it('retries pending responses with bounded exponential backoff', async () => {
    const statuses = [202, 202, 200]
    const sleeps: number[] = []
    const requests: Array<[string, string]> = []

    const result = await pollClaimVerification(
      TRANSACTION_ID,
      HASH,
      async (transactionId, hash) => {
        requests.push([transactionId, hash])
        return response(statuses.shift() ?? 200)
      },
      {
        sleep: async milliseconds => {
          sleeps.push(milliseconds)
        },
      }
    )

    expect(result.status).toBe(200)
    expect(requests).toHaveLength(3)
    expect(
      requests.every(([id, hash]) => id === TRANSACTION_ID && hash === HASH)
    ).toBe(true)
    expect(sleeps).toEqual([1000, 1000, 2000])
  })

  it('returns pending after the attempt limit instead of retrying forever', async () => {
    let requests = 0
    const sleeps: number[] = []

    const result = await pollClaimVerification(
      TRANSACTION_ID,
      HASH,
      async () => {
        requests += 1
        return response(202)
      },
      {
        maxAttempts: 3,
        sleep: async milliseconds => {
          sleeps.push(milliseconds)
        },
      }
    )

    expect(result.status).toBe(202)
    expect(requests).toBe(3)
    expect(sleeps).toEqual([1000, 1000, 2000])
  })

  it('retries transient provider responses before surfacing the result', async () => {
    const statuses = [503, 200]
    const sleeps: number[] = []

    const result = await pollClaimVerification(
      TRANSACTION_ID,
      HASH,
      async () => response(statuses.shift() ?? 200),
      {
        sleep: async milliseconds => {
          sleeps.push(milliseconds)
        },
      }
    )

    expect(result.status).toBe(200)
    expect(sleeps).toEqual([1000, 1000])
  })
})
