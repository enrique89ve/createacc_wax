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

    expect(result).toEqual({ success: true, transactionId: 'tx1' })
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
      success: false,
      error: 'The Hive result is still pending',
      requiresReconciliation: true,
      correlationId: 'create-attempt-123',
    })
  })
})
