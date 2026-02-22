/**
 * Shared types for the credits system.
 */

/** Partial row from SELECT id */
export interface UserIdRow {
	readonly id: number
}

/**
 * Complete credits information for a builder
 */
export interface BuilderCreditsInfo {
	builder_id: number
	hive_username: string
	pending_amount: number
	available_amount: number
	total_assigned: number
	total_consumed: number
}

/**
 * Operation to assign credits
 */
export interface AssignCreditsOperation {
	hive_username: string
	amount: number
	source: string
	assigned_by_admin: number
}
