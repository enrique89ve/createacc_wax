import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSession } from '@/lib/form/form-submit'
import type { PowSolution } from '@/utils/pow-solver'

const POW: PowSolution = { challengeId: 'challenge', nonce: 'nonce' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createSession', () => {
  it('preserves the server ticket-not-found reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            success: false,
            details: {
              kind: 'ticket_validation',
              code: 'notFound',
            },
          },
          { status: 400 }
        )
      )
    )

    await expect(
      createSession('alice', 'TICKET', POW, 'timing-token')
    ).resolves.toEqual({
      success: false,
      reason: 'ticket_invalid',
      ticketValidationErrorCode: 'notFound',
    })
  })

  it('preserves Retry-After from the session rate limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: 'Too many requests. Please try again later.' },
          { status: 429, headers: { 'Retry-After': '42' } }
        )
      )
    )

    await expect(
      createSession('alice', 'TICKET', POW, 'timing-token')
    ).resolves.toEqual({
      success: false,
      reason: 'rate_limited',
      retryAfterSeconds: 42,
    })
  })

  it('returns a recoverable result when fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )

    await expect(
      createSession('alice', 'TICKET', POW, 'timing-token')
    ).resolves.toEqual({ success: false, reason: 'service_unavailable' })
  })
})
