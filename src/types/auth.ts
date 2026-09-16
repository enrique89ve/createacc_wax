/**
 * Authentication and session types for HolaHive
 */

import type { UserRole } from '@/lib/roles'

export type AuthMethod = 'password' | 'keychain'

export interface CreationSession {
  readonly username: string
  readonly ticket?: string
  readonly confirmedDownload?: boolean
  readonly accountCreated?: boolean
}

export interface AdminSession {
  readonly userId: string
  readonly username: string
  readonly role: typeof UserRole.Admin
  readonly loginTime: number
}

export interface BuilderSession {
  readonly username: string
  readonly role: typeof UserRole.Builder
  readonly issuedAt: number
  readonly expiresAt: number
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
