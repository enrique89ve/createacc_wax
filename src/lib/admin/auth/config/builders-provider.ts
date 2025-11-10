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

  async authorize(credentials) {
    if (!credentials?.username || !credentials?.message) {
      return null
    }

    const result = await validateCredentials(
      {
        username: credentials.username as string,
        message: credentials.message as string,
        publicKey: (credentials.publicKey as string) || '',
        signature: (credentials.signature as string) || '',
        timestamp: credentials.timestamp
          ? Number(credentials.timestamp)
          : Date.now(),
      },
      'keychain'
    if (result.success && result.user) {
      return {
        id: result.user.id || result.user.username, // Use database ID if available, fallback to username
        username: result.user.username,
        role: 'builder', // Unified role system
        auth_method: 'keychain',
        loginTime: Date.now(),
      }
    }

    return null
  },
})
