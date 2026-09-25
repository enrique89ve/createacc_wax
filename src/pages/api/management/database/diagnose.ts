import type { APIRoute } from 'astro'
import { HTTP_STATUS } from '@/consts/constants'
import { diagnoseDatabaseConsistency } from '@/lib/database-diagnostics'
import { inspectDatabaseSchema } from '@/lib/database-schema-preflight'
import { withReadSnapshot } from '@/lib/database'
import { withAdminApiSession } from '@/lib/session-helpers'
import {
  assertCanPerform,
  Permission,
  unauthorizedResponse,
} from '@/lib/auth/permissions'
import { apiError, apiSuccess } from '@/utils/errorResponse'

export const GET: APIRoute = async context =>
  withAdminApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.VIEW_DATABASE_DIAGNOSTICS,
        'GET /api/management/database/diagnose'
      )
    } catch {
      return unauthorizedResponse()
    }

    try {
      return await withReadSnapshot(async () => {
        const preflight = await inspectDatabaseSchema()
        if (!preflight.schemaCompatible || !preflight.foreignKeysEnabled) {
          return apiError(
            'La base de datos requiere revisión de esquema antes del diagnóstico',
            HTTP_STATUS.SERVICE_UNAVAILABLE
          )
        }
        return apiSuccess({
          preflight,
          diagnostics: await diagnoseDatabaseConsistency(),
        })
      })
    } catch {
      return apiError(
        'No fue posible diagnosticar la base de datos',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
