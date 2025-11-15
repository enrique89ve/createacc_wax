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
  private generateSecureMessage(
    username: HiveUsername,
    customMessage?: string
  ): HiveMessage {
    const timestamp = Date.now()
    const baseMessage =
      customMessage ||
      `Please sign this message to verify your identity with HolaHive`
    const message = `${baseMessage}\nUsername: ${username}\nTimestamp: ${timestamp}`

    return createHiveMessage(message)
  }

  /**
   * Extrae mensaje de error limpio
   */
  private extractErrorMessage(value: unknown): string {
    if (!value) return 'Error desconocido'
    if (typeof value === 'string') return value
    if (typeof value === 'object') {
      const obj = value as any
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

    return new Promise(resolve => {
      try {
        const message = this.generateSecureMessage(hiveUsername, customMessage)

        window.hive_keychain!.requestSignBuffer(
          username.trim(),
          message,
          keyType,
          async (response: HiveKeychainResponse) => {
            if (response.success) {
              // Keychain signature field mapping
              const signature = response.result || (response as any).signature

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
      } catch (error) {
        resolve({
          success: false,
          error: `Error en login: ${error instanceof Error ? error.message : 'Error desconocido'}`,
        })
      }
    })
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
