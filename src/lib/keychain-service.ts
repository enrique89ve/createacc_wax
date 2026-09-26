/**
 * 🔐 HIVE KEYCHAIN SERVICE - Simplified version
 *
 * Service to interact with Hive Keychain using native API
 * Only essential functions used in production
 */

import type {
  HiveKeychainResponse,
  HiveKeychainAuthResult,
  HiveKeychainLoginParams,
  HiveMessage,
} from '@/types/hive-signature'
import { createHiveUsername, createHiveMessage } from '@/types/hive-signature'
import { z } from 'astro/zod'
import { readApiResponse } from '@/utils/api-client'

const BuilderChallengeResponseSchema = z.looseObject({
  message: z.string().min(1),
})

// Global declaration for TypeScript
declare global {
  interface Window {
    hive_keychain?: {
      requestSignBuffer: (
        username: string,
        message: string,
        method: 'Posting' | 'Active' | 'Memo',
        callback: (response: HiveKeychainResponse) => void,
        title?: string
      ) => void
    }
  }
}

/**
 * Main class to handle Keychain using native API
 */
export class HiveKeychainService {
  private isExtensionAvailable: boolean = false

  constructor() {
    this.checkAvailability()
  }

  /**
   * Check if Keychain is available
   */
  private checkAvailability(): boolean {
    this.isExtensionAvailable =
      typeof window !== 'undefined' &&
      typeof window.hive_keychain === 'object' &&
      typeof window.hive_keychain?.requestSignBuffer === 'function'

    return this.isExtensionAvailable
  }

  /**
   * Verify availability and status
   */
  isKeychainReady(): boolean {
    return this.checkAvailability()
  }

  /**
   * Wait for Keychain to be available
   */
  async waitForKeychain(maxWait: number = 5000): Promise<boolean> {
    const startTime = Date.now()

    while (Date.now() - startTime < maxWait) {
      if (this.checkAvailability()) {
        return true
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    return false
  }

  /**
   * Requests the exact login message from the server. The client only signs it.
   */
  private async fetchLoginMessage(username: string): Promise<HiveMessage> {
    const response = await fetch('/api/auth/challenge', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    })
    const result = await readApiResponse(
      response,
      BuilderChallengeResponseSchema
    )
    if (!response.ok || !result.ok) {
      throw new Error('No se pudo obtener challenge del servidor')
    }
    if (!result.data.message) {
      throw new Error('Challenge inválido recibido del servidor')
    }
    return createHiveMessage(result.data.message)
  }

  /**
   * Extracts clean error message
   */
  private extractErrorMessage(value: unknown): string {
    if (!value) return 'Error desconocido'
    if (typeof value === 'string') return value
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>
      if (obj.message) return String(obj.message)
      if (obj.error) return String(obj.error)
      try {
        return JSON.stringify(value)
      } catch {
        return 'Error desconocido'
      }
    }
    return String(value) || 'Error desconocido'
  }

  /**
   * Login with Keychain
   */
  async login(
    params: HiveKeychainLoginParams
  ): Promise<HiveKeychainAuthResult> {
    const { username, keyType = 'Posting', title = 'Login Request' } = params

    // Verify availability
    if (!this.checkAvailability()) {
      return {
        success: false,
        error: 'Hive Keychain no está disponible',
      }
    }

    const hiveUsername = createHiveUsername(username)

    try {
      const message = await this.fetchLoginMessage(hiveUsername)

      const KEYCHAIN_TIMEOUT_MS = 60_000

      const keychainPromise = new Promise<HiveKeychainAuthResult>(resolve => {
        window.hive_keychain!.requestSignBuffer(
          hiveUsername,
          message,
          keyType,
          (response: HiveKeychainResponse) => {
            if (response.success) {
              // Keychain signature field mapping
              const signature = response.result || response.signature

              resolve({
                success: true,
                username: createHiveUsername(
                  response.data?.username || username
                ),
                publicKey: response.publicKey,
                message: createHiveMessage(response.data?.message || message),
                signature,
                requestId: response.request_id,
                timestamp: Date.now(),
              })
            } else {
              const error =
                this.extractErrorMessage(response.error) ||
                this.extractErrorMessage(response.message) ||
                'Login falló'
              resolve({
                success: false,
                error,
              })
            }
          },
          title
        )
      })

      const timeoutPromise = new Promise<HiveKeychainAuthResult>(resolve => {
        setTimeout(
          () =>
            resolve({
              success: false,
              error: 'Keychain no respondió en el tiempo esperado (60s)',
            }),
          KEYCHAIN_TIMEOUT_MS
        )
      })

      return await Promise.race([keychainPromise, timeoutPromise])
    } catch (error) {
      return {
        success: false,
        error: `Error en login: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      }
    }
  }
}

// ===== CONVENIENCE FUNCTIONS =====

/**
 * Helper function to check if Keychain is ready
 */
export async function isKeychainReady(): Promise<boolean> {
  const service = new HiveKeychainService()
  return service.waitForKeychain()
}

/**
 * Helper function for quick login
 */
export async function quickLogin(
  username: string,
  keyType: 'Posting' | 'Active' | 'Memo' = 'Posting'
): Promise<HiveKeychainAuthResult> {
  const service = new HiveKeychainService()
  return service.login({ username: createHiveUsername(username), keyType })
}
