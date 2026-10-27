import type { APIRoute } from 'astro'
import { resolveClientIp } from '@/lib/client-ip'
import { handleUsernameValidation } from '@/lib/username-validation-api'

export const POST: APIRoute = async context =>
  handleUsernameValidation(
    context.request,
    resolveClientIp(context),
    'inviteUsername'
  )
