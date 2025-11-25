/**
 * 🔐 BUILDER AUTHENTICATION HELPERS
 *
 * Helpers centralizados para autenticación y obtención de datos de builders.
 * Elimina duplicación de código de autenticación en múltiples endpoints.
 *
 * Uso:
 * ```typescript
 * const builderId = await getAuthenticatedBuilderId(request)
 * const builder = await getAuthenticatedBuilder(request)
 * ```
 */

import { getSession } from 'auth-astro/server'
import { db } from '@/lib/database'
import { parseUserRow, type DatabaseUserRow } from '@/types/database'
import { HTTP_STATUS } from '@/consts/constants'

// Constante para role de builder (evita magic strings)
const BUILDER_ROLE = 'builder' as const

/**
 * Error lanzado cuando no hay sesión autenticada
 */
export class UnauthenticatedError extends Error {
  readonly status = HTTP_STATUS.UNAUTHORIZED
  constructor(message = 'No autenticado') {
    super(message)
    this.name = 'UnauthenticatedError'
  }
}

/**
 * Error lanzado cuando el usuario no es un builder
 */
export class NotBuilderError extends Error {
  readonly status = HTTP_STATUS.FORBIDDEN
  constructor(message = 'Usuario no es un builder') {
    super(message)
    this.name = 'NotBuilderError'
  }
}

/**
 * Error lanzado cuando el builder no está activo
 */
export class InactiveBuilderError extends Error {
  readonly status = HTTP_STATUS.FORBIDDEN
  constructor(message = 'Builder inactivo') {
    super(message)
    this.name = 'InactiveBuilderError'
  }
}

/**
 * Obtener el ID del builder autenticado
 *
 * @throws {UnauthenticatedError} Si no hay sesión o username
 * @throws {NotBuilderError} Si el usuario no es un builder
 * @returns Builder ID
 */
export async function getAuthenticatedBuilderId(
  request: Request
): Promise<number> {
  const session = await getSession(request)

  if (!session?.user?.username) {
    throw new UnauthenticatedError('No hay sesión activa')
  }

  const hiveUsername = session.user.username

  const builderResult = await db.execute({
    sql: `SELECT id FROM Users WHERE username = ? AND role = ?`,
    args: [hiveUsername, BUILDER_ROLE],
  })

  if (builderResult.rows.length === 0) {
    throw new NotBuilderError('Builder no encontrado')
  }

  return Number(builderResult.rows[0].id)
}

/**
 * Obtener los datos completos del builder autenticado
 *
 * @throws {UnauthenticatedError} Si no hay sesión o username
 * @throws {NotBuilderError} Si el usuario no es un builder
 * @returns Datos completos del builder
 */
export async function getAuthenticatedBuilder(
  request: Request
): Promise<DatabaseUserRow> {
  const session = await getSession(request)

  if (!session?.user?.username) {
    throw new UnauthenticatedError('No hay sesión activa')
  }

  const hiveUsername = session.user.username

  const builderResult = await db.execute({
    // SEGURIDAD: Columnas explícitas - NO incluir password_hash
    sql: `SELECT id, username, role, is_active, last_claim_at, created_at, updated_at FROM Users WHERE username = ? AND role = ?`,
    args: [hiveUsername, BUILDER_ROLE],
  })

  if (builderResult.rows.length === 0) {
    throw new NotBuilderError('Builder no encontrado')
  }

  const builder = parseUserRow(builderResult.rows[0])

  if (!builder) {
    throw new Error('Error al parsear datos del builder')
  }

  return builder
}

/**
 * Obtener el ID del builder autenticado solo si está activo
 *
 * @throws {UnauthenticatedError} Si no hay sesión o username
 * @throws {NotBuilderError} Si el usuario no es un builder
 * @throws {InactiveBuilderError} Si el builder no está activo
 * @returns Builder ID
 */
export async function getActiveBuilderId(request: Request): Promise<number> {
  const session = await getSession(request)

  if (!session?.user?.username) {
    throw new UnauthenticatedError('No hay sesión activa')
  }

  const hiveUsername = session.user.username

  const builderResult = await db.execute({
    sql: `SELECT id, is_active FROM Users WHERE username = ? AND role = ?`,
    args: [hiveUsername, BUILDER_ROLE],
  })

  if (builderResult.rows.length === 0) {
    throw new NotBuilderError('Builder no encontrado')
  }

  // Usar parseUserRow parcial para type safety
  const rawRow = builderResult.rows[0]
  const builderId = Number(rawRow.id)
  const isActive = Boolean(rawRow.is_active)

  if (!isActive) {
    throw new InactiveBuilderError('Builder inactivo')
  }

  return builderId
}

/**
 * Helper para manejar errores de autenticación y convertirlos en Response
 *
 * Uso:
 * ```typescript
 * export const GET: APIRoute = async ({ request }) => {
 *   try {
 *     const builderId = await getAuthenticatedBuilderId(request)
 *     // ...
 *   } catch (error) {
 *     return handleAuthError(error)
 *   }
 * }
 * ```
 */
export function handleAuthError(error: unknown): Response {
  if (
    error instanceof UnauthenticatedError ||
    error instanceof NotBuilderError ||
    error instanceof InactiveBuilderError
  ) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: error.status,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  // Error no esperado
  return new Response(
    JSON.stringify({
      success: false,
      error: 'Error interno del servidor',
    }),
    {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}
