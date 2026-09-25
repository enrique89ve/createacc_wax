import { afterEach, describe, expect, it, vi } from 'vitest'
import { validateUsername } from '@/lib/form/username-validation'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('validateUsername policy request', () => {
  it('fails closed on rate limits and performs one policy request', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429,
          headers: { 'Retry-After': '37' },
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const getChain = vi.fn(async () => null)

    await expect(validateUsername('alice', getChain)).resolves.toEqual({
      status: 'check_unavailable',
      retryAfterSeconds: 37,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/validate/username',
      expect.objectContaining({ method: 'POST' })
    )
    expect(getChain).not.toHaveBeenCalled()
  })

  it('stops before the Hive lookup when policy rejects the username', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'similar' }, { status: 200 }))
    )
    const getChain = vi.fn(async () => null)

    await expect(validateUsername('alice', getChain)).resolves.toEqual({
      status: 'similar',
    })
    expect(getChain).not.toHaveBeenCalled()
  })
})
