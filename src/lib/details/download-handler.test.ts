import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmKeysDownloaded } from '@/lib/details/download-handler'
import type { PublicKeySet } from '@/types/keys'

const PUBLIC_KEYS: PublicKeySet = {
  ownerPublicKey: 'STM7ownerpub',
  activePublicKey: 'STM7activepub',
  postingPublicKey: 'STM7postingpub',
  memoPublicKey: 'STM7memopub',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('confirmKeysDownloaded', () => {
  it('recovers the session once and retries only the public key confirmation', async () => {
    const requests: RequestInit[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init) requests.push(init)
      return requests.length === 1
        ? new Response(null, { status: 401 })
        : new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const recoverSession = vi.fn(async () => true)

    await expect(
      confirmKeysDownloaded(PUBLIC_KEYS, recoverSession)
    ).resolves.toEqual({ status: 'confirmed' })
    expect(recoverSession).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(requests[0]?.body))).toEqual(PUBLIC_KEYS)
    expect(JSON.parse(String(requests[1]?.body))).toEqual(PUBLIC_KEYS)
  })

  it('does not claim confirmation when session recovery fails', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const recoverSession = vi.fn(async () => false)

    await expect(
      confirmKeysDownloaded(PUBLIC_KEYS, recoverSession)
    ).resolves.toEqual({ status: 'session_recovery_failed' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps a file download separate from a failed server confirmation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 }))
    )

    await expect(
      confirmKeysDownloaded(PUBLIC_KEYS, async () => false)
    ).resolves.toEqual({ status: 'rejected' })
  })
})
