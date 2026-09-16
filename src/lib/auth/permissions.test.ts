import { describe, expect, it } from 'vitest'
import { UserRole } from '@/lib/roles'
import { canPerform, Permission } from '@/lib/auth/permissions'

describe('unified role permissions', () => {
  it('lets builders create tickets without treating credits as a permission', () => {
    const session = {
      username: 'alice',
      role: UserRole.Builder as const,
      issuedAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
    }
    expect(canPerform(session, Permission.CREATE_TICKET)).toBe(true)
    expect(canPerform(session, Permission.MANAGE_CREDITS)).toBe(false)
  })

  it('prevents builders from accessing admin operations', () => {
    const session = {
      username: 'alice',
      role: UserRole.Builder as const,
      issuedAt: 1,
      expiresAt: Number.MAX_SAFE_INTEGER,
    }
    expect(canPerform(session, Permission.VIEW_ALL_TICKETS)).toBe(false)
    expect(canPerform(session, Permission.ADMIN_ADJUSTMENTS)).toBe(false)
  })

  it('prevents admins from impersonating builder ownership permissions', () => {
    const session = {
      userId: 'admin-id',
      username: 'admin',
      role: UserRole.Admin as const,
      loginTime: Date.now(),
    }
    expect(canPerform(session, Permission.CREATE_TICKET)).toBe(false)
    expect(canPerform(session, Permission.VIEW_OWN_TICKETS)).toBe(false)
    expect(canPerform(session, Permission.MANAGE_CREDITS)).toBe(true)
  })
})
