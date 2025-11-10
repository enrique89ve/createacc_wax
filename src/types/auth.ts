/**
 * Authentication and session types for HolaHive
 */

import type { UserRole } from '@/consts/constants'

// ===== PERMISSION MODEL =====

export type AuthMethod = 'password' | 'keychain'

export type SuperAdminPermission =
  | 'manage_system'
  | 'manage_users'
  | 'manage_tickets'
  | 'manage_moderators'
  | 'view_analytics'

export type ModeratorPermission =
  | 'create_tickets'
  | 'moderate_users'
  | 'view_user_activity'

export type UserPermission =
  | 'create_accounts'
  | 'buy_credits'
  | 'view_own_activity'

export type Permission =
  | SuperAdminPermission
  | ModeratorPermission
  | UserPermission

// ===== ACTIVE SESSION TYPES =====

export interface CreationSession {
  readonly username: string
  readonly ticket?: string
  readonly confirmedDownload?: boolean
  readonly accountCreated?: boolean
}

export interface LegacyUserSession {
  readonly userId: number
  readonly username: string
  readonly role: UserRole
  readonly ticketQuota?: number
  readonly ticketsCreated?: number
  readonly loginTime: string
}

export interface LoginRequest {
  readonly username: string
  readonly password: string
}

export interface LoginResponse {
  readonly success: boolean
  readonly user?: {
    readonly id: number
    readonly username: string
    readonly role: UserRole
    readonly ticket_quota: number
    readonly tickets_created: number
  }
  readonly redirectTo?: string
  readonly error?: string
}

export interface LogoutResponse {
  readonly success: boolean
  readonly message: string
  readonly redirectTo: string
}

// ===== MANAGEMENT SESSION TYPES =====

export interface AdminSession {
  readonly userId: number
  readonly username: string
  readonly role: 'admin' | 'builder'
  readonly loginTime: string
}

interface UniversalSessionBase<
  Role extends 'superadmin' | 'moderator' | 'user',
  Perm extends Permission,
> {
  readonly userId: string
  readonly username: string
  readonly role: Role
  readonly authMethod: AuthMethod
  readonly permissions: readonly Perm[]
  readonly ticketQuota: number
  readonly loginTime: string
}

export type SuperAdminSession = UniversalSessionBase<
  'superadmin',
  SuperAdminPermission
>

export type ModeratorSession = UniversalSessionBase<
  'moderator',
  ModeratorPermission
>

export type RegularUserSession = UniversalSessionBase<'user', UserPermission>

export type UniversalSession =
  | SuperAdminSession
  | ModeratorSession
  | RegularUserSession

// Extend Astro's locals type for legacy support
declare global {
  namespace App {
    interface Locals {
      creation?: CreationSession
      adminUser?: AdminSession
      user?: UniversalSession
    }
  }
}

export {}
