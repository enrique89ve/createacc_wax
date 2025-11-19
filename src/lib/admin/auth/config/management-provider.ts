/**
 * Auth provider configuration for management area
 * Handles admin authentication with password + optional 2FA
 */

import Credentials from '@auth/core/providers/credentials'
import { validateCredentials } from '@/lib/admin/auth/validators/unified-validator'
import type { PasswordCredentials } from '@/lib/admin/auth/validators/unified-validator'

/**
 * Credentials provider for management area
 * Supports admin and referral user authentication
 */
export const managementProvider = Credentials({
  id: 'management-credentials',
  name: 'Management Login',
  credentials: {
    username: {
      label: 'Username',
      type: 'text',
      placeholder: 'Enter your username',
    },
    password: {
      label: 'Password',
      type: 'password',
      placeholder: 'Enter your password',
    },
  },

  async authorize(rawCredentials) {
    const credentials = rawCredentials ?? {}

    const username =
      typeof credentials.username === 'string'
        ? credentials.username.trim()
        : ''
    const password =
      typeof credentials.password === 'string' ? credentials.password : ''

    if (!username || !password) {
      return null
    }

    const passwordCredentials: PasswordCredentials = {
      type: 'password',
      username,
      password,
    }

    const result = await validateCredentials(passwordCredentials, 'password')
    if (!result.success) {
      console.warn(
        `Management login failed for user ${username}:`,
        result.error
      )
      return null
    }

    const { user } = result

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      auth_method: user.auth_method,
      loginTime: user.loginTime,
    }
  },
})
