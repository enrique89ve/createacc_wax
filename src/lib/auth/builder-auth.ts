/**
 * 🔐 BUILDER AUTHENTICATION HELPERS
 *
 * Centralized helpers for authentication and getting builders data.
 * Eliminates authentication code duplication in multiple endpoints.
 *
 * Usage:
 * ```typescript
 * const builderId = await getAuthenticatedBuilderId(request)
 * const builder = await getAuthenticatedBuilder(request)
 * ```
 */

import { getSession } from 'auth-astro/server'
import { db } from '@/lib/database'
import { parseUserRow, type DatabaseUserRow } from '@/types/database'
import { HTTP_STATUS } from '@/consts/constants'

// Constant for builder role (avoids magic strings)
const BUILDER_ROLE = 'builder' as const

/**
 * Error thrown when there is no authenticated session
 */
export class UnauthenticatedError extends Error {
  readonly status = HTTP_STATUS.UNAUTHORIZED
  constructor(message = 'No autenticado') {
    super(message)
    this.name = 'UnauthenticatedError'
  }
}

/**
 * Error thrown when the user is not a builder
 */
export class NotBuilderError extends Error {
  readonly status = HTTP_STATUS.FORBIDDEN
  constructor(message = 'Usuario no es un builder') {
    super(message)
    this.name = 'NotBuilderError'
  }
}

/**
 * Error thrown when the builder is not active
 */
export class InactiveBuilderError extends Error {
  readonly status = HTTP_STATUS.FORBIDDEN
  constructor(message = 'Builder inactivo') {
    super(message)
    this.name = 'InactiveBuilderError'
  }
}

/**
 * Get the authenticated builder ID
 *
 * @throws {UnauthenticatedError} If there is no session or username
 * @throws {NotBuilderError} If the user is not a builder
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
 * Get the full data of the authenticated builder
 *
 * @throws {UnauthenticatedError} If there is no session or username
 * @throws {NotBuilderError} If the user is not a builder
 * @returns Full builder data
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
    // SECURITY: Explicit columns - DO NOT include password_hash
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
 * Get the authenticated builder ID only if it is active
 *
 * @throws {UnauthenticatedError} If there is no session or username
 * @throws {NotBuilderError} If the user is not a builder
 * @throws {InactiveBuilderError} If the builder is not active
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

  // Use partial parseUserRow for type safety
  const rawRow = builderResult.rows[0]
  const builderId = Number(rawRow.id)
  const isActive = Boolean(rawRow.is_active)

  if (!isActive) {
    throw new InactiveBuilderError('Builder inactivo')
  }

  return builderId
}

/**
 * Helper to handle authentication errors and convert them to Response
 *
 * Usage:
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

  // Unexpected error
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
