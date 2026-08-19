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
	readonly userId: string
	readonly userHash: string
	readonly username: string
	readonly role: typeof UserRole.Admin
	readonly loginTime: number
}

export interface BuilderSession {
	readonly userId: string
	readonly userHash: string
	readonly username: string
	readonly role: typeof UserRole.Builder
	readonly loginTime: number
}

export interface PendingBuilder {
	readonly username: string
}

declare global {
	namespace App {
		interface Locals {
			creation?: CreationSession
			adminUser?: AdminSession
			builderUser?: BuilderSession
			pendingBuilder?: PendingBuilder
		}
	}
}

export {}
