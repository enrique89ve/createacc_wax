/**
 * Utilidades para manejo de errores del lado cliente
 * Basado en patrones observados en la-velada-web-oficial
 */

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from '@/utils/errorResponse'
import { validateAccountName } from '@/utils/validate-username'
import { validateTicket } from '@/utils/validate-ticket'

/**
 * Configuración de retry para operaciones cliente
 */
interface RetryConfig {
  maxRetries: number
  delayMs: number
  backoffMultiplier: number
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
}

/**
 * Resultado de operación cliente
 */
export interface ClientOperationResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
  retryable?: boolean
}

/**
 * Sleep utility para delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Determina si un error de red es retryable
 */
function isRetryableError(error: unknown): boolean {
  // Errores de red típicamente retryables
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true
  }

  // Errores de timeout
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error.name === 'AbortError' ||
      ('message' in error &&
        typeof error.message === 'string' &&
        error.message.includes('timeout')))
  ) {
    return true
  }

  // Códigos HTTP retryables
  if (error && typeof error === 'object' && 'status' in error) {
    const retryableStatuses = [408, 429, 500, 502, 503, 504]
    return retryableStatuses.includes(error.status as number)
  }

  return false
}

/**
 * Wrapper para fetch con retry logic y error handling mejorado
 */
export async function fetchWithRetry<T = unknown>(
  url: string,
  options: RequestInit = {},
  retryConfig: Partial<RetryConfig> = {}
): Promise<ClientOperationResult<T>> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
  let lastError: unknown

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      // Parse de respuesta
      const data = await response.json()

      if (!response.ok) {
        // Manejar errores de API estructurados
        if (data.error && data.code) {
          const apiError = data as ApiErrorResponse
          return {
            success: false,
            error: apiError.message || apiError.error,
            code: apiError.code,
            retryable: isRetryableError({ status: response.status }),
          }
        }

        // Error HTTP genérico
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Respuesta exitosa
      if (data.success !== undefined) {
        // Formato ApiSuccessResponse
        const apiSuccess = data as ApiSuccessResponse<T>
        return {
          success: true,
          data: apiSuccess.data,
        }
      }

      // Datos directos
      return {
        success: true,
        data,
      }
    } catch (error) {
      lastError = error

      // Si no es retryable o ya agotamos intentos, devolver error
      if (!isRetryableError(error) || attempt === config.maxRetries) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          retryable: isRetryableError(error),
        }
      }

      // Delay exponencial para siguiente intento
      const delay = config.delayMs * Math.pow(config.backoffMultiplier, attempt)
      // Log retry en desarrollo
      await sleep(delay)
    }
  }

  // Esto no debería ejecutarse, pero TypeScript lo requiere
  return {
    success: false,
    error:
      lastError instanceof Error
        ? lastError.message
        : 'All retry attempts failed',
    retryable: false,
  }
}

/**
 * Cache simple para evitar requests duplicados
 */
class RequestCache {
  private cache = new Map<string, { data: unknown; expiry: number }>()
  private readonly defaultTtl = 30000 // 30 segundos

  set<T>(key: string, data: T, ttl: number = this.defaultTtl): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttl,
    })
  }

  get<T>(key: string): T | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    if (Date.now() > entry.expiry) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  invalidate(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }
}

export const requestCache = new RequestCache()

/**
 * Fetch con cache automático
 */
export async function fetchWithCache<T = unknown>(
  url: string,
  options: RequestInit = {},
  cacheConfig: { key?: string; ttl?: number } = {}
): Promise<ClientOperationResult<T>> {
  const cacheKey = cacheConfig.key || `${options.method || 'GET'}_${url}`

  // Intentar obtener desde cache solo para GET requests
  if (!options.method || options.method === 'GET') {
    const cached = requestCache.get<T>(cacheKey)
    if (cached) {
      return { success: true, data: cached }
    }
  }

  const result = await fetchWithRetry<T>(url, options)

  // Cachear solo respuestas exitosas de GET
  if (result.success && (!options.method || options.method === 'GET')) {
    requestCache.set(cacheKey, result.data, cacheConfig.ttl)
  }

  return result
}

/**
 * Helper para mostrar errores al usuario con fallback
 */
export function formatErrorForUser(
  error: ClientOperationResult | string,
  defaultMessage: string = 'Ha ocurrido un error inesperado'
): string {
  if (typeof error === 'string') {
    return error
  }

  if (error.error) {
    // Si hay un mensaje específico, usarlo
    return error.error
  }

  return defaultMessage
}

/**
 * Simple validation result interface
 */
interface ValidationResult<T = any> {
  isValid: boolean
  data?: T
  error?: string
}

/**
 * Valida formulario antes de envío
 */
export function validateFormData(formData: FormData): ValidationResult<{
  username: string
  ticketCode?: string
}> {
  const username = formData.get('username') as string
  const ticketCode = formData.get('ticketCode') as string

  // Validar username
  const trimmedUsername = username?.trim()
  if (!trimmedUsername) {
    return { isValid: false, error: 'Username is required' }
  }

  const usernameError = validateAccountName(trimmedUsername)
  if (usernameError) {
    return { isValid: false, error: usernameError }
  }
  // Ticket es opcional pero si está presente debe ser válido
  if (ticketCode?.trim()) {
    const ticketError = validateTicket(ticketCode.trim())
    if (ticketError) {
      return { isValid: false, error: ticketError }
    }
  }

  return {
    isValid: true,
    data: {
      username: trimmedUsername,
      ticketCode: ticketCode?.trim() || undefined,
    },
  }
}

/**
 * Handler mejorado para errores de formulario con validación
 */
export function handleFormError(
  error: ClientOperationResult | ValidationResult | string,
  formElement?: HTMLFormElement
): void {
  let message: string

  if (typeof error === 'string') {
    message = error
  } else if ('isValid' in error && !error.isValid) {
    // Es un ValidationResult
    message = error.error || 'Error de validación'
  } else if ('success' in error && !error.success) {
    // Es un ClientOperationResult
    message = error.error || 'Error desconocido'
  } else {
    message = 'Ha ocurrido un error inesperado'
  }

  // ✅ FAIL FAST: Mostrar error inmediatamente sin procesar más

  if (formElement) {
    let errorElement = formElement.querySelector<HTMLElement>('.form-error')

    if (!errorElement) {
      errorElement = document.createElement('div')
      errorElement.className = 'form-error text-red-500 text-sm mt-2'
      formElement.appendChild(errorElement)
    }

    errorElement.textContent = message

    // Auto-hide después de 5 segundos
    setTimeout(() => {
      errorElement?.remove()
    }, 5000)
  } else {
    alert(message)
  }
}

/**
 * Estado global simple para manejo de loading
 */
export class LoadingState {
  private loadingElements = new Set<HTMLElement>()

  setLoading(element: HTMLElement, loading: boolean): void {
    if (loading) {
      this.loadingElements.add(element)
      element.setAttribute('data-loading', 'true')
      if (element instanceof HTMLButtonElement) {
        element.disabled = true
      }
    } else {
      this.loadingElements.delete(element)
      element.removeAttribute('data-loading')
      if (element instanceof HTMLButtonElement) {
        element.disabled = false
      }
    }
  }

  isLoading(element: HTMLElement): boolean {
    return this.loadingElements.has(element)
  }

  clearAll(): void {
    this.loadingElements.forEach(element => {
      this.setLoading(element, false)
    })
    this.loadingElements.clear()
  }
}

export const globalLoadingState = new LoadingState()
