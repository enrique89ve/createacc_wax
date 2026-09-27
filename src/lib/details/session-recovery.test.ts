import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiSuccess } from '@/utils/errorResponse'
import { TIMING_THRESHOLDS } from '@/consts/pow'
import { recoverCreationSessionForKeyConfirmation } from '@/lib/details/session-recovery'

const { ensureTimingMatured } = vi.hoisted(() => ({
  ensureTimingMatured: vi.fn(async () => undefined),
}))

vi.mock('@/utils/pow-solver', () => ({
  obtainPowSolution: vi.fn(async () => ({
    challengeId: 'challenge-1',
    nonce: 'nonce-1',
  })),
  fetchTimingToken: vi.fn(async () => 'timing-1'),
}))

vi.mock('@/utils/timing-maturation', () => ({ ensureTimingMatured }))

afterEach(() => {
  vi.unstubAllGlobals()
  ensureTimingMatured.mockClear()
})

describe('recoverCreationSessionForKeyConfirmation', () => {
  it('sends a fresh timing token with a ticketed recovery session', async () => {
    let requestBody = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        requestBody = String(init?.body ?? '')
        return apiSuccess({ username: 'alice' })
      })
    )

    await expect(
      recoverCreationSessionForKeyConfirmation('alice', 'ticket-1')
    ).resolves.toBe(true)

    expect(ensureTimingMatured).toHaveBeenCalledWith(
      expect.any(Number),
      TIMING_THRESHOLDS.flow
    )
    expect(JSON.parse(requestBody)).toEqual({
      username: 'alice',
      pow: { challengeId: 'challenge-1', nonce: 'nonce-1' },
      timingTokenId: 'timing-1',
      ticket: 'ticket-1',
    })
  })
})

describe('session recovery response contract', () => {
  it.each([
    () => new Response('<html>Unavailable</html>', { status: 200 }),
    () => apiSuccess({ username: 'someone-else' }),
    () => apiSuccess({}),
  ])('rejects invalid responses and another username', async response => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response())
    )
    expect(
      await recoverCreationSessionForKeyConfirmation('alice', 'ticket-1')
    ).toBe(false)
  })
})
