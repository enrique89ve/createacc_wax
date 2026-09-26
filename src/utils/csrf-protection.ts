/**
 * CSRF Protection via Origin Header Validation
 *
 * Validates that the Origin header of the request matches the server host.
 * This prevents CSRF attacks where a malicious site attempts to execute
 * actions on behalf of the authenticated user.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
 */

import { HTTP_STATUS } from '@/consts/constants'
import { apiError } from '@/utils/errorResponse'

/**
 * CSRF validation result
 */
export interface CsrfValidationResult {
  readonly valid: boolean
  readonly error?: string
}

/**
 * Allowed hosts for local development
 */
const ALLOWED_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

/**
 * Validates the Origin header against the request host
 *
 * @param request - Incoming HTTP request
 * @returns Validation result
 */
export function validateOrigin(request: Request): CsrfValidationResult {
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  // If no Origin or Referer, reject (could be a direct malicious request)
  // Note: Some browsers don't send Origin in same-origin requests,
  // but they do send Referer
  if (!origin && !referer) {
    // Allow requests without Origin/Referer only for internal APIs (fetch from the same site)
    // This is safe because SameSite=Strict on cookies already prevents CSRF
    // However, for maximum security, we require at least one
    return {
      valid: false,
      error: 'Missing Origin or Referer header',
    }
  }

  const requestUrl = new URL(request.url)
  const requestHost = requestUrl.host

  // Validate Origin if present
  if (origin) {
    try {
      const originUrl = new URL(origin)
      const originHost = originUrl.host

      // Compare hosts
      if (originHost === requestHost) {
        return { valid: true }
      }

      // Allow local development
      if (isDevEnvironment(requestHost) && isDevEnvironment(originHost)) {
        return { valid: true }
      }

      return {
        valid: false,
        error: `Origin mismatch: ${originHost} !== ${requestHost}`,
      }
    } catch {
      return {
        valid: false,
        error: 'Invalid Origin header',
      }
    }
  }

  // Fallback to Referer if no Origin
  if (referer) {
    try {
      const refererUrl = new URL(referer)
      const refererHost = refererUrl.host

      if (refererHost === requestHost) {
        return { valid: true }
      }

      // Permitir desarrollo local
      if (isDevEnvironment(requestHost) && isDevEnvironment(refererHost)) {
        return { valid: true }
      }

      return {
        valid: false,
        error: `Referer mismatch: ${refererHost} !== ${requestHost}`,
      }
    } catch {
      return {
        valid: false,
        error: 'Invalid Referer header',
      }
    }
  }

  return { valid: true }
}

/**
 * Verifies if the host is for local development
 */
function isDevEnvironment(host: string): boolean {
  const hostname = host.split(':')[0]
  return ALLOWED_DEV_HOSTS.has(hostname)
}

/**
 * Middleware helper to validate CSRF in mutating endpoints
 *
 * Usage:
 * ```typescript
 * export const POST: APIRoute = async ({ request }) => {
 *   const csrfCheck = requireValidOrigin(request)
 *   if (csrfCheck) return csrfCheck
 *
 *   // ... rest of the endpoint
 * }
 * ```
 *
 * @param request - Incoming HTTP request
 * @returns Error Response if validation fails, null if valid
 */
export function requireValidOrigin(request: Request): Response | null {
  const validation = validateOrigin(request)

  if (!validation.valid) {
    return apiError('CSRF validation failed', HTTP_STATUS.FORBIDDEN)
  }

  return null
}
