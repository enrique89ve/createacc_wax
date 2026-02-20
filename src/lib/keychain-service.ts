/**
 * 🔐 HIVE KEYCHAIN SERVICE - Versión simplificada
 *
 * Servicio para interactuar con Hive Keychain usando la API nativa
 * Solo las funciones esenciales que se usan en producción
 */

import type {
  HiveKeychainResponse,
  HiveKeychainAuthResult,
  HiveKeychainLoginParams,
  HiveUsername,
  HiveMessage,
} from '@/types/hive-signature'
import { createHiveUsername, createHiveMessage } from '@/types/hive-signature'

enum KeychainLoginMessage {
  DefaultPrefix = 'Login to HiveAccount Creation at',
  FallbackOrigin = 'https://join.holahive.com',
}

// Declaración global para TypeScript
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
 * Clase principal para manejar Keychain usando API nativa
 */
export class HiveKeychainService {
  private isExtensionAvailable: boolean = false

  constructor() {
    this.checkAvailability()
  }

  /**
   * Verifica si Keychain está disponible
   */
  private checkAvailability(): boolean {
    this.isExtensionAvailable =
      typeof window !== 'undefined' &&
      typeof window.hive_keychain === 'object' &&
      typeof window.hive_keychain?.requestSignBuffer === 'function'

    return this.isExtensionAvailable
  }

  /**
   * Verifica disponibilidad y estado
   */
  isKeychainReady(): boolean {
    return this.checkAvailability()
  }

  /**
   * Esperar a que Keychain esté disponible
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
   * Genera mensaje seguro para firmar
   */
  private resolveLoginPrefix(customMessage?: string): string {
    if (customMessage) {
      return customMessage
    }

    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : KeychainLoginMessage.FallbackOrigin

    return `${KeychainLoginMessage.DefaultPrefix} ${origin}`
  }

  /**
   * Solicita un nonce criptográfico al servidor para prevenir replay attacks
   */
  private async fetchChallenge(): Promise<string> {
    const response = await fetch('/api/auth/challenge')
    if (!response.ok) {
      throw new Error('No se pudo obtener challenge del servidor')
    }
    const data = await response.json()
    return data.nonce
  }

  private async generateSecureMessage(
    username: HiveUsername,
    customMessage?: string
  ): Promise<HiveMessage> {
    const timestamp = Date.now()
    const nonce = await this.fetchChallenge()
    const baseMessage = this.resolveLoginPrefix(customMessage)
    const message = `${baseMessage}\nUsername: ${username}\nTimestamp: ${timestamp}\nNonce: ${nonce}`

    return createHiveMessage(message)
  }

  /**
   * Extrae mensaje de error limpio
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
   * Login con Keychain
   */
  async login(
    params: HiveKeychainLoginParams
  ): Promise<HiveKeychainAuthResult> {
    const {
      username,
      customMessage,
      keyType = 'Posting',
      title = 'Login Request',
    } = params

    // Verificar disponibilidad
    if (!this.checkAvailability()) {
      return {
        success: false,
        error: 'Hive Keychain no está disponible',
      }
    }

    const hiveUsername = createHiveUsername(username)

    try {
      const message = await this.generateSecureMessage(hiveUsername, customMessage)

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
                signature: signature,
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
        setTimeout(() => resolve({
          success: false,
          error: 'Keychain no respondió en el tiempo esperado (60s)',
        }), KEYCHAIN_TIMEOUT_MS)
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

// ===== FUNCIONES DE CONVENIENCIA =====

/**
 * Helper function para verificar si Keychain está listo
 */
export async function isKeychainReady(): Promise<boolean> {
  const service = new HiveKeychainService()
  return service.waitForKeychain()
}

/**
 * Helper function para login rápido
 */
export async function quickLogin(
  username: string,
  keyType: 'Posting' | 'Active' | 'Memo' = 'Posting'
): Promise<HiveKeychainAuthResult> {
  const service = new HiveKeychainService()
  return service.login({ username: createHiveUsername(username), keyType })
}
