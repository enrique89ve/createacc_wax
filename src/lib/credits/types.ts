export interface CreditBalance {
  readonly hive_username: string
  readonly pending_amount: number
  readonly available_amount: number
  readonly total_issued: number
  readonly total_consumed: number
  readonly revision: number
}

export interface AssignCreditsOperation {
  readonly hive_username: string
  readonly amount: number
  readonly source: string
  readonly assigned_by_admin: string
}

export const ZERO_BALANCE = (hiveUsername: string): CreditBalance => ({
  hive_username: hiveUsername,
  pending_amount: 0,
  available_amount: 0,
  total_issued: 0,
  total_consumed: 0,
  revision: 0,
})
