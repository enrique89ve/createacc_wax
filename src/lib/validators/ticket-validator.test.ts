import { describe, expect, it } from 'vitest'
import { validateCreditsDelta } from './ticket-validator'

describe('validateCreditsDelta', () => {
  it('preserves consumed uses when adding capacity', () => {
    expect(validateCreditsDelta(7, 2, 10)).toEqual({
      success: true,
      data: { delta: 2, newCredits: 9 },
    })
  })

  it('rejects a change that would exceed the total capacity limit', () => {
    expect(validateCreditsDelta(7, 1, 100).success).toBe(false)
  })
})
