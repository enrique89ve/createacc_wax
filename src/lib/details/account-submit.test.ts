import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitAccountCreation } from '@/lib/details/account-submit'
import type { PublicKeySet } from '@/types/keys'
import { PRIVATE_KEY_FIELD_NAMES } from '@/types/keys'

const PUBLIC_KEYS: PublicKeySet = {
  ownerPublicKey: 'STM7ownerpub',
  activePublicKey: 'STM7activepub',
  postingPublicKey: 'STM7postingpub',
  memoPublicKey: 'STM7memopub',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('submitAccountCreation', () => {
  it('sends only username, public keys, pow and timing token', async () => {
    let body = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        body = String(init?.body ?? '')
        return new Response(
          JSON.stringify({ success: true, transactionId: 'tx1' }),
          { status: 200 }
        )
      })
    )

    const result = await submitAccountCreation(
      'alice',
      PUBLIC_KEYS,
      { challengeId: 'c1', nonce: 'n1' },
      'timing-1'
    )

    expect(result).toEqual({ status: 'created', transactionId: 'tx1' })
    const parsed = JSON.parse(body) as Record<string, unknown>
    expect(parsed).toEqual({
      username: 'alice',
      ...PUBLIC_KEYS,
      pow: { challengeId: 'c1', nonce: 'n1' },
      timingTokenId: 'timing-1',
    })
    for (const field of PRIVATE_KEY_FIELD_NAMES) {
      expect(body).not.toContain(field)
      expect(Object.prototype.hasOwnProperty.call(parsed, field)).toBe(false)
    }
  })

  it('preserves the reconciliation reference and pending outcome for HTTP 202', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              error: 'The Hive result is still pending',
              requiresReconciliation: true,
              correlationId: 'create-attempt-123',
            }),
            { status: 202 }
          )
      )
    )

    await expect(
      submitAccountCreation(
        'alice',
        PUBLIC_KEYS,
        { challengeId: 'c1', nonce: 'n1' },
        'timing-1'
      )
    ).resolves.toEqual({
      status: 'pending',
      reason: 'reconciliation',
      correlationId: 'create-attempt-123',
    })
  })

  it('preserves known rejection codes without exposing server messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              error: 'Ticket not found: internal details',
              errorCode: 'TICKET_NOT_FOUND',
              databaseUpdated: false,
            }),
            { status: 400 }
          )
      )
    )

    await expect(
      submitAccountCreation(
        'alice',
        PUBLIC_KEYS,
        { challengeId: 'c1', nonce: 'n1' },
        'timing-1'
      )
    ).resolves.toEqual({
      status: 'rejected',
      httpStatus: 400,
      errorCode: 'TICKET_NOT_FOUND',
    })
  })

  it('reports a transport failure as an unknown outcome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection reset')
      })
    )

    await expect(
      submitAccountCreation(
        'alice',
        PUBLIC_KEYS,
        { challengeId: 'c1', nonce: 'n1' },
        'timing-1'
      )
    ).resolves.toEqual({ status: 'unknown' })
  })

  it('treats an unsuccessful response after a broadcast as unresolved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              errorCode: 'INTERNAL_ERROR',
              broadcasted: true,
              databaseUpdated: false,
            }),
            { status: 500 }
          )
      )
    )

    await expect(
      submitAccountCreation(
        'alice',
        PUBLIC_KEYS,
        { challengeId: 'c1', nonce: 'n1' },
        'timing-1'
      )
    ).resolves.toEqual({ status: 'pending', reason: 'reconciliation' })
  })

  it('keeps an existing creation attempt in the pending state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              errorCode: 'ACCOUNT_CREATION_IN_PROGRESS',
              correlationId: 'create-attempt-456',
            }),
            { status: 409 }
          )
      )
    )

    await expect(
      submitAccountCreation(
        'alice',
        PUBLIC_KEYS,
        { challengeId: 'c1', nonce: 'n1' },
        'timing-1'
      )
    ).resolves.toEqual({
      status: 'pending',
      reason: 'creation_in_progress',
      correlationId: 'create-attempt-456',
    })
  })
})
