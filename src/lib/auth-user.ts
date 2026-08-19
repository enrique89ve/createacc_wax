import { UserRole } from '@/lib/roles'
import type { AuthMethod } from '@/types/auth'

export const HIVE_AUTH_EMAIL_DOMAIN = 'users.hive'

export function hiveAuthEmail(username: string): string {
	return `${username.trim().toLowerCase()}@${HIVE_AUTH_EMAIL_DOMAIN}`
}

export interface AppAuthProfile {
	readonly username: string
	readonly role: UserRole
	readonly authMethod: AuthMethod
	readonly appUserId: number
}

export function isAdminRole(role: string): boolean {
	return role === UserRole.Admin
}

export function isBuilderRole(role: string): boolean {
	return role === UserRole.Builder
}
