/**
 * CREDITS SERVICE - Facade
 *
 * Re-exports all credit operations as a unified singleton.
 * Consumers import { creditsService } from '@/lib/credits-service' — no changes needed.
 *
 * Internal modules:
 * - credits/core.ts      → Builder lifecycle (claim, deduct, consume, refund)
 * - credits/admin.ts     → Admin operations (assign, transfer, adjust)
 * - credits/history.ts   → Audit history queries
 * - credits/shared.ts    → Internal helpers (getOrCreateCreditRow, insertCreditAudit)
 * - credits/types.ts     → Shared type definitions
 */

import { claimCredits, deductCreditsForTicket, markCreditsAsConsumed, refundCreditsFromTicket } from './credits/core'
import { assignCredits, transferCredits, adjustCredits } from './credits/admin'
import { getCreditHistory, getCreditAuditHistory } from './credits/history'

export type { BuilderCreditsInfo, AssignCreditsOperation } from './credits/types'

export const creditsService = {
	assignCredits,
	claimCredits,
	deductCreditsForTicket,
	markCreditsAsConsumed,
	refundCreditsFromTicket,
	transferCredits,
	adjustCredits,
	getCreditHistory,
	getCreditAuditHistory,
} as const
