/**
 * Authentication and session types for HolaHive
 */

import type { UserRole } from '@/lib/roles'

export type AuthMethod = 'password' | 'keychain'

// ===== ACTIVE SESSION TYPES =====

export interface CreationSession {
	readonly username: string
	readonly ticket?: string
	readonly confirmedDownload?: boolean
	readonly accountCreated?: boolean
}

// ===== MANAGEMENT SESSION TYPES =====

export interface AdminSession {
	readonly userId: number
	readonly username: string
	readonly role: UserRole
	readonly loginTime: number
}

export interface BuilderSession {
	readonly userId: number
	readonly username: string
	readonly role: UserRole
	readonly loginTime: number
}

declare global {
	namespace App {
		interface Locals {
			creation?: CreationSession
			adminUser?: AdminSession
			builderUser?: BuilderSession
		}
	}
}

export {}
