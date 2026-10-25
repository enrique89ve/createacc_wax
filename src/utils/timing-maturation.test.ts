import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensureTimingMatured,
  isTimingTokenFresh,
} from '@/utils/timing-maturation'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('monotonic timing token age', () => {
  it('does not use the adjustable wall clock for token freshness or maturity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2040-01-01T00:00:00.000Z'))
    vi.spyOn(performance, 'now').mockReturnValue(1_050)

    expect(isTimingTokenFresh(1_000)).toBe(true)
    const maturity = ensureTimingMatured(1_000, 100, 0)

    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(50)
    await expect(maturity).resolves.toBeUndefined()
  })

  it('cancels a pending timing wait when the page intent is aborted', async () => {
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockReturnValue(1_000)
    const controller = new AbortController()

    const maturity = ensureTimingMatured(1_000, 100, 0, controller.signal)
    controller.abort('page left')

    await expect(maturity).rejects.toThrow('Timing wait cancelled')
    expect(vi.getTimerCount()).toBe(0)
  })
})
