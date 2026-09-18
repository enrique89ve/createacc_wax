import { describe, expect, it } from 'vitest'
import { validateTicketName, validateUsesDelta } from './ticket-validator'
import { deriveTicketKind, deriveTicketStatus } from '@/types/database'

describe('validateUsesDelta', () => {
  it('preserves consumed uses when adding capacity', () => {
    expect(validateUsesDelta(7, 2, 10)).toEqual({
      success: true,
      data: { delta: 2, newUses: 9 },
    })
  })

  it('rejects a change that would exceed the total capacity limit', () => {
    expect(validateUsesDelta(7, 1, 100).success).toBe(false)
  })

  it('allows resizing remaining uses down to zero', () => {
    expect(validateUsesDelta(2, -2, 10)).toEqual({
      success: true,
      data: { delta: -2, newUses: 0 },
    })
  })

  it('keeps total ticket uses at least one', () => {
    expect(validateUsesDelta(1, -1, 1).success).toBe(false)
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

describe('validateTicketName', () => {
  it('rejects non-string boundary input without throwing', () => {
    expect(validateTicketName({})).toEqual({
      success: false,
      error: {
        message: 'El nombre del ticket no puede estar vacío',
        field: 'code',
      },
    })
  })
})
