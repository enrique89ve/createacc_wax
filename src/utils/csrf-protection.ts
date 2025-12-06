/**
 * CSRF Protection via Origin Header Validation
 *
 * Valida que el header Origin de la request coincida con el host del servidor.
 * Esto previene ataques CSRF donde un sitio malicioso intenta ejecutar
 * acciones en nombre del usuario autenticado.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
 */

import { HTTP_STATUS } from '@/consts/constants'

/**
 * Resultado de la validación CSRF
 */
export interface CsrfValidationResult {
	readonly valid: boolean
	readonly error?: string
}

/**
 * Hosts permitidos para desarrollo local
 */
const ALLOWED_DEV_HOSTS = new Set([
	'localhost',
	'127.0.0.1',
	'0.0.0.0',
])

/**
 * Valida el header Origin contra el host de la request
 *
 * @param request - Request HTTP entrante
 * @returns Resultado de validación
 */
export function validateOrigin(request: Request): CsrfValidationResult {
	const origin = request.headers.get('origin')
	const referer = request.headers.get('referer')

	// Si no hay Origin ni Referer, rechazar (podría ser request directa maliciosa)
	// Nota: Algunos navegadores no envían Origin en requests same-origin,
	// pero sí envían Referer
	if (!origin && !referer) {
		// Permitir requests sin Origin/Referer solo para APIs internas (fetch desde el mismo sitio)
		// Esto es seguro porque SameSite=Strict en cookies ya previene CSRF
		// Sin embargo, para máxima seguridad, requerimos al menos uno
		return {
			valid: false,
			error: 'Missing Origin or Referer header',
		}
	}

	const requestUrl = new URL(request.url)
	const requestHost = requestUrl.host

	// Validar Origin si está presente
	if (origin) {
		try {
			const originUrl = new URL(origin)
			const originHost = originUrl.host

			// Comparar hosts
			if (originHost === requestHost) {
				return { valid: true }
			}

			// Permitir desarrollo local
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

	// Fallback a Referer si no hay Origin
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
 * Verifica si el host es de desarrollo local
 */
function isDevEnvironment(host: string): boolean {
	const hostname = host.split(':')[0]
	return ALLOWED_DEV_HOSTS.has(hostname)
}

/**
 * Middleware helper para validar CSRF en endpoints mutantes
 *
 * Uso:
 * ```typescript
 * export const POST: APIRoute = async ({ request }) => {
 *   const csrfCheck = requireValidOrigin(request)
 *   if (csrfCheck) return csrfCheck
 *
 *   // ... resto del endpoint
 * }
 * ```
 *
 * @param request - Request HTTP entrante
 * @returns Response de error si la validación falla, null si es válida
 */
export function requireValidOrigin(request: Request): Response | null {
	const validation = validateOrigin(request)

	if (!validation.valid) {
		return new Response(
			JSON.stringify({
				success: false,
				error: 'CSRF validation failed',
			}),
			{
				status: HTTP_STATUS.FORBIDDEN,
				headers: { 'Content-Type': 'application/json' },
			}
		)
	}

	return null
}
