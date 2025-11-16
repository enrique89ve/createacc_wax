/**
 * Auth provider configuration for builders area
 * Handles Hive Keychain authentication for community users
 */

import Credentials from '@auth/core/providers/credentials'
import {
  validateCredentials,
  type KeychainCredentials,
} from '@/lib/admin/auth/validators/unified-validator'

/**
 * Keychain provider for builders area
 * Allows any Hive user to authenticate with Keychain
 */
export const buildersProvider = Credentials({
  id: 'builders-keychain',
  name: 'Hive Keychain',
  credentials: {
    username: {
      label: 'Hive Username',
      type: 'text',
      placeholder: 'Enter your Hive username',
    },
    message: {
      label: 'Signed Message',
      type: 'text',
      placeholder: 'Message signed with Keychain',
    },
    publicKey: {
      label: 'Public Key',
      type: 'text',
      placeholder: 'Your Hive public key (optional)',
    },
    signature: {
      label: 'Signature',
      type: 'hidden',
    },
    timestamp: {
      label: 'Timestamp',
      type: 'hidden',
    },
  },

  async authorize(rawCredentials) {
    const credentials = rawCredentials ?? {}
    const username =
      typeof credentials.username === 'string'
        ? credentials.username.trim()
        : ''
    const message =
      typeof credentials.message === 'string' ? credentials.message : ''

    if (!username || !message) {
      return null
    }

    const keychainCredentials: KeychainCredentials = {
      type: 'keychain',
      username,
      message,
      publicKey: credentials.publicKey
        ? String(credentials.publicKey)
        : undefined,
      signature: credentials.signature
        ? String(credentials.signature)
        : undefined,
      timestamp: credentials.timestamp
        ? Number(credentials.timestamp)
        : Date.now(),
    }

    const result = await validateCredentials(keychainCredentials, 'keychain')
    if (!result.success) {
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
