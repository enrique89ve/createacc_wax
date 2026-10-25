import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiSuccess } from '@/utils/errorResponse'
import {
  fetchTimingToken,
  fetchTimingTokenPair,
  obtainPowBundle,
  obtainPowSolution,
} from '@/utils/pow-solver'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PoW request retries', () => {
  it('does not retry a client error', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: 'bad request' }, { status: 400 })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTimingToken()).rejects.toThrow(
      'PoW request rejected: 400'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clears the backoff and stops after the caller aborts', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi.fn(async () =>
      Response.json({ error: 'retry' }, { status: 503 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    const request = fetchTimingToken(controller.signal)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()

    await expect(request).rejects.toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries a server error once inside the budget', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(Response.json({ error: 'retry' }, { status: 503 }))
      .mockResolvedValueOnce(apiSuccess({ timingTokenId: 'timing-2' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = fetchTimingToken()
    await vi.advanceTimersByTimeAsync(250)

    await expect(request).resolves.toBe('timing-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('waits for Retry-After before retrying a rate-limited request', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        Response.json(
          { error: 'slow down' },
          {
            status: 429,
            headers: { 'Retry-After': '1' },
          }
        )
      )
      .mockResolvedValueOnce(apiSuccess({ timingTokenId: 'timing-2' }))
    vi.stubGlobal('fetch', fetchMock)

    const request = fetchTimingToken()
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(request).resolves.toBe('timing-2')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('obtains a PoW and timing token with one request', async () => {
    const fetchMock = vi.fn(async () =>
      apiSuccess({
        challengeId: '0123456789abcdef0123456789abcdef',
        prefix: 'abcdef0123456789abcdef0123456789',
        difficulty: 1,
        expiresAt: Date.now() + 5_000,
        expiresInMs: 5_000,
        timingTokenId: 'timing-bundled',
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const bundle = await obtainPowBundle()

    expect(bundle.timingTokenId).toBe('timing-bundled')
    expect(bundle.pow.challengeId).toBe('0123456789abcdef0123456789abcdef')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pow/challenge?withTiming=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('solves a fresh challenge when the client wall clock is far ahead', async () => {
    const serverTime = Date.now()
    const fetchMock = vi.fn(async () => {
      const response = apiSuccess({
        challengeId: '0123456789abcdef0123456789abcdef',
        prefix: 'abcdef0123456789abcdef0123456789',
        difficulty: 1,
        expiresAt: serverTime + 5_000,
        expiresInMs: 5_000,
      })
      vi.spyOn(Date, 'now').mockReturnValue(serverTime + 24 * 60 * 60 * 1000)
      return response
    })
    vi.stubGlobal('fetch', fetchMock)

    const solution = await obtainPowSolution()

    expect(solution.challengeId).toBe('0123456789abcdef0123456789abcdef')
    expect(solution.nonce).toMatch(/^[0-9a-f]{1,16}$/u)
  })

  it('fetches two independent timing tokens in one request', async () => {
    const fetchMock = vi.fn(async () =>
      apiSuccess({ timingTokenIds: ['timing-flow', 'timing-ticket'] })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchTimingTokenPair()).resolves.toEqual([
      'timing-flow',
      'timing-ticket',
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/pow/timing?count=2',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })
})
