import {
  claimCredits,
  deductCreditsForTicket,
  markCreditsAsConsumed,
  refundCreditsFromTicket,
} from './credits/core'
import { assignCredits, transferCredits, adjustCredits } from './credits/admin'
import { getCreditHistory, getCreditAuditHistory } from './credits/history'

export type {
  CreditBalance as BuilderCreditsInfo,
  AssignCreditsOperation,
} from './credits/types'

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
