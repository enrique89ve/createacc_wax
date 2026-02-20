/**
 * Utilities for client-side error handling
 * Based on patterns observed in la-velada-web-oficial
 */

import type {
  ApiErrorResponse,
  ApiSuccessResponse,
} from '@/utils/errorResponse'
import { validateAccountName } from '@/utils/validate-username'
import { validateTicket } from '@/utils/validate-ticket'

/**
 * Retry configuration for client operations
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
 * Client operation result
 */
export interface ClientOperationResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
  code?: string
  retryable?: boolean
}

/**
 * Sleep utility for delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Determines if a network error is retryable
 */
function isRetryableError(error: unknown): boolean {
  // Typically retryable network errors
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true
  }

  // Timeout errors
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

  // Retryable HTTP codes
  if (error && typeof error === 'object' && 'status' in error) {
    const retryableStatuses = [408, 429, 500, 502, 503, 504]
    return retryableStatuses.includes(error.status as number)
  }

  return false
}

/**
 * Fetch wrapper with retry logic and improved error handling
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

      // Parse response
      const data = await response.json()

      if (!response.ok) {
        // Handle structured API errors
        if (data.error && data.code) {
          const apiError = data as ApiErrorResponse
          return {
            success: false,
            error: apiError.message || apiError.error,
            code: apiError.code,
            retryable: isRetryableError({ status: response.status }),
          }
        }

        // Generic HTTP error
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Successful response
      if (data.success !== undefined) {
        // ApiSuccessResponse format
        const apiSuccess = data as ApiSuccessResponse<T>
        return {
          success: true,
          data: apiSuccess.data,
        }
      }

      // Direct data
      return {
        success: true,
        data,
      }
    } catch (error) {
      lastError = error

      // If not retryable or attempts exhausted, return error
      if (!isRetryableError(error) || attempt === config.maxRetries) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          retryable: isRetryableError(error),
        }
      }

      // Exponential delay for next attempt
      const delay = config.delayMs * Math.pow(config.backoffMultiplier, attempt)
      // Log retry in development
      await sleep(delay)
    }
  }

  // This should not be executed, but TypeScript requires it
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
 * Simple cache to avoid duplicate requests
 */
class RequestCache {
  private cache = new Map<string, { data: unknown; expiry: number }>()
  private readonly defaultTtl = 30000 // 30 seconds

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
 * Fetch with automatic cache
 */
export async function fetchWithCache<T = unknown>(
  url: string,
  options: RequestInit = {},
  cacheConfig: { key?: string; ttl?: number } = {}
): Promise<ClientOperationResult<T>> {
  const cacheKey = cacheConfig.key || `${options.method || 'GET'}_${url}`

  // Try to get from cache only for GET requests
  if (!options.method || options.method === 'GET') {
    const cached = requestCache.get<T>(cacheKey)
    if (cached) {
      return { success: true, data: cached }
    }
  }

  const result = await fetchWithRetry<T>(url, options)

  // Cache only successful GET responses
  if (result.success && (!options.method || options.method === 'GET')) {
    requestCache.set(cacheKey, result.data, cacheConfig.ttl)
  }

  return result
}

/**
 * Helper to show errors to the user with fallback
 */
export function formatErrorForUser(
  error: ClientOperationResult | string,
  defaultMessage: string = 'Ha ocurrido un error inesperado'
): string {
  if (typeof error === 'string') {
    return error
  }

  if (error.error) {
    // If there is a specific message, use it
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
 * Validates form before submission
 */
export function validateFormData(formData: FormData): ValidationResult<{
  username: string
  ticketCode?: string
}> {
  const username = formData.get('username') as string
  const ticketCode = formData.get('ticketCode') as string

  // Validate username
  const trimmedUsername = username?.trim()
  if (!trimmedUsername) {
    return { isValid: false, error: 'Username is required' }
  }

  const usernameError = validateAccountName(trimmedUsername)
  if (usernameError) {
    return { isValid: false, error: usernameError }
  }
  // Ticket is optional but if present must be valid
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
 * Improved handler for form errors with validation
 */
export function handleFormError(
  error: ClientOperationResult | ValidationResult | string,
  formElement?: HTMLFormElement
): void {
  let message: string

  if (typeof error === 'string') {
    message = error
  } else if ('isValid' in error && !error.isValid) {
    // It is a ValidationResult
    message = error.error || 'Validation error'
  } else if ('success' in error && !error.success) {
    // It is a ClientOperationResult
    message = error.error || 'Unknown error'
  } else {
    message = 'Ha ocurrido un error inesperado'
  }

  // ✅ FAIL FAST: Show error immediately without further processing

  if (formElement) {
    let errorElement = formElement.querySelector<HTMLElement>('.form-error')

    if (!errorElement) {
      errorElement = document.createElement('div')
      errorElement.className = 'form-error text-red-500 text-sm mt-2'
      formElement.appendChild(errorElement)
    }

    errorElement.textContent = message

    // Auto-hide after 5 seconds
    setTimeout(() => {
      errorElement?.remove()
    }, 5000)
  } else {
    alert(message)
  }
}

/**
 * Simple global state for loading management
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
