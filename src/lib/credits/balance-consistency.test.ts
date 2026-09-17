import { describe, expect, it } from 'vitest'
import { calculateExpectedAvailable } from '@/lib/credit-balance-tracker'

describe('credit balance consistency calculation', () => {
  it('includes every available ledger component with its stored sign', () => {
    expect(
      calculateExpectedAvailable({
        assigned: 10,
        granted_available: 8,
        claimed: 5,
        spent_on_tickets: -2,
        refunded_from_tickets: 1,
        consumed_on_accounts: -3,
        admin_adjustments: -1,
        admin_pending_adjustments: 2,
        legacy_transfer_in: 4,
        legacy_transfer_out: -3,
      })
    ).toBe(12)
  })
})
