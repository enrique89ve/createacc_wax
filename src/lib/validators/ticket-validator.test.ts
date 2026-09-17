import { describe, expect, it } from 'vitest'
import { validateCreditsDelta } from './ticket-validator'
import { deriveTicketKind, deriveTicketStatus } from '@/types/database'

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

  it('derives ticket kind and lifecycle from persisted facts', () => {
    expect(deriveTicketKind(1)).toBe('single_use')
    expect(deriveTicketKind(10)).toBe('multi_use')
    expect(deriveTicketStatus(10, 10, null)).toBe('unused')
    expect(deriveTicketStatus(10, 7, null)).toBe('partially_used')
    expect(deriveTicketStatus(10, 0, null)).toBe('exhausted')
    expect(deriveTicketStatus(10, 7, '2026-09-16')).toBe('revoked')
  })
})
