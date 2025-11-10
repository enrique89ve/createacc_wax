/**
 * Shared Auth.js callbacks for consistent session handling
 * Used across all authentication providers
 */

import type { JWT } from '@auth/core/jwt'
import type { Session, User } from '@auth/core/types'

/**
 * JWT callback - Stores user data in token
 */
export async function jwtCallback({
	token,
	user
}: {
	token: JWT
	user?: User
}) {
  // On sign in, store user data in token
  if (user) {
    token.userId = user.id
    token.username = user.username
    token.role = user.role
    token.type = user.type // Add type for auth-guards
    token.auth_method = user.auth_method
    token.loginTime = user.loginTime
  }

  return token
}

/**
 * Session callback - Transforms token data into session
 */
export async function sessionCallback({
  session,
  token,
}: {
  session: Session
  token: JWT
}) {
  // Send properties to the client
  if (token && session.user) {
    session.user.id = token.userId as string
    session.user.username = token.username as string
    session.user.role = token.role as string
    session.user.type = token.type as string // Add type for auth-guards
    session.user.auth_method = token.auth_method as string
    session.user.loginTime = token.loginTime as number
  }

  return session
}

/**
 * Sign in callback - Controls access based on user data
 */
export async function signInCallback({ user }: { user: User }) {
  // Allow sign in if user object exists and has required fields
  // Note: role is optional for admin users (type='admin')
  const isValidUser = Boolean(
    user?.id && user?.username && user?.auth_method &&
    (user?.role || user?.type === 'admin') // Admin users don't need role
  return isValidUser
}

/**
 * Redirect callback - Controls where users go after authentication
 */
export async function redirectCallback({
  url,
  baseUrl,
}: {
  url: string
  baseUrl: string
}) {
  // Handle signout cases - redirect to builders login to avoid management access issues
  if (url.includes('/api/auth/signout') || url.includes('signOut=true')) {
    return `${baseUrl}/builders/login`
  }

  // Handle management access errors - redirect to builders instead of creating loops
  if (
    url.includes('/management/access') &&
    !url.includes('/api/auth/callback/management-')
  ) {
    return `${baseUrl}/builders/login`
  }

  // Management area paths - check FIRST before builders (most specific)
  if (
    url.includes('/api/auth/callback/management-') ||
    url.includes('callbackUrl=%2Fmanagement%2Fconsole') ||
    url.includes('callbackUrl=/management/console') ||
    url.includes('/management/console') ||
    url === '/management/console' ||
    (url.startsWith('/management/') && !url.includes('/management/access'))
  ) {
    return `${baseUrl}/management/console`
  }

  // Check if this is a builders area authentication
  if (
    url.includes('/api/auth/callback/builders-keychain') ||
    url.includes('callbackUrl=%2Fbuilders%2Ftickets') ||
    url.includes('callbackUrl=/builders/tickets') ||
    url.includes('/builders/')
  ) {
    return `${baseUrl}/builders/tickets`
  }

  // For builders login failures, redirect to builders login instead of management
  if (url.includes('/builders/login') || url === baseUrl) {
    return `${baseUrl}/builders/login`
  }

  // Default to builders login instead of management to avoid access issues
  return `${baseUrl}/builders/login`
}
