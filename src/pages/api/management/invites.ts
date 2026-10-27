import type { APIRoute } from 'astro'
import {
  assertCanPerform,
  Permission,
  unauthorizedResponse,
} from '@/lib/auth/permissions'
import { withAdminApiSession } from '@/lib/session-helpers'
import { getFreshAdminSession } from '@/lib/auth/admin-auth'
import { getInviteConfiguration } from '@/lib/invite/config'
import {
  getInviteCampaignSettings,
  InviteCampaignSettingsError,
  updateInviteCampaignSettings,
} from '@/lib/invite/campaign-settings'
import { hasInviteSchema, requireInviteSchemaKey } from '@/lib/invite/schema'
import { apiError, apiSuccess } from '@/utils/errorResponse'
import { requireValidOrigin } from '@/utils/csrf-protection'
import { parseJsonObject } from '@/utils/http-input'

const responseOptions = {
  noCache: true,
  headers: { 'Referrer-Policy': 'no-referrer' },
} as const

async function prepareCampaignRequest(): Promise<{
  readonly providers: { readonly github: boolean; readonly twitter: boolean }
} | null> {
  const configuration = getInviteConfiguration()
  if (!configuration || !(await hasInviteSchema())) return null
  await requireInviteSchemaKey(configuration.identitySecret)
  return {
    providers: {
      github: Boolean(configuration.providers.github),
      twitter: Boolean(configuration.providers.twitter),
    },
  }
}

export const GET: APIRoute = async context =>
  withAdminApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        Permission.MANAGE_INVITE_CAMPAIGN,
        'GET /api/management/invites'
      )
    } catch {
      return unauthorizedResponse()
    }

    try {
      const configuration = await prepareCampaignRequest()
      if (!configuration) {
        return apiError(
          'Configura el secreto de invitaciones y ejecuta pnpm invite:init',
          503,
          undefined,
          responseOptions
        )
      }
      return apiSuccess(
        {
          settings: await getInviteCampaignSettings(),
          providers: configuration.providers,
        },
        200,
        responseOptions
      )
    } catch {
      return apiError(
        'No fue posible cargar la configuración de invitaciones',
        503,
        undefined,
        responseOptions
      )
    }
  })

export const PUT: APIRoute = async context => {
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  const sessionResult = await getFreshAdminSession(context.request)
  if (sessionResult.kind === 'unauthenticated') {
    return apiError(
      'Se requiere una sesión de administrador activa',
      401,
      { code: 'UNAUTHENTICATED' },
      responseOptions
    )
  }
  if (sessionResult.kind === 'unavailable') {
    return apiError(
      'No se pudo verificar la sesión',
      503,
      { code: 'AUTH_SESSION_UNAVAILABLE' },
      responseOptions
    )
  }
  const session = sessionResult.session
  try {
    assertCanPerform(
      session,
      Permission.MANAGE_INVITE_CAMPAIGN,
      'PUT /api/management/invites'
    )
  } catch {
    return unauthorizedResponse()
  }

  try {
    const configuration = await prepareCampaignRequest()
    if (!configuration) {
      return apiError(
        'Configura el secreto de invitaciones y ejecuta pnpm invite:init',
        503,
        undefined,
        responseOptions
      )
    }
    const body = await parseJsonObject(context.request)
    if (!body) {
      return apiError(
        'El cuerpo de la solicitud no es válido',
        400,
        undefined,
        responseOptions
      )
    }
    if (
      body.enabled === true &&
      !configuration.providers.github &&
      !configuration.providers.twitter
    ) {
      return apiError(
        'Configura al menos un proveedor OAuth antes de activar la campaña',
        409,
        undefined,
        responseOptions
      )
    }
    const updated = await updateInviteCampaignSettings(session, body)
    return apiSuccess(updated, 200, responseOptions)
  } catch (error) {
    if (error instanceof InviteCampaignSettingsError) {
      const status =
        error.code === 'INVALID_COMMAND'
          ? 400
          : error.code === 'SCHEMA_UNAVAILABLE'
            ? 503
            : 409
      return apiError(error.message, status, undefined, responseOptions)
    }
    return apiError(
      'No fue posible guardar la configuración de invitaciones',
      500,
      undefined,
      responseOptions
    )
  }
}
