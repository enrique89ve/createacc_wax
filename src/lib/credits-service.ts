import {
  claimCredits,
  deductCreditsForTicket,
  grantAvailableCredits,
  markCreditsAsConsumed,
  refundCreditsFromTicket,
} from './credits/core'
import { assignCredits } from './credits/admin'
import { getCreditHistory, getCreditAuditHistory } from './credits/history'

export type {
  CreditBalance as BuilderCreditsInfo,
  AssignCreditsOperation,
} from './credits/types'

export const creditsService = {
  assignCredits,
  claimCredits,
  grantAvailableCredits,
  deductCreditsForTicket,
  markCreditsAsConsumed,
  refundCreditsFromTicket,
  getCreditHistory,
  getCreditAuditHistory,
} as const
