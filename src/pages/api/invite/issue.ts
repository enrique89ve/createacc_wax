import type { APIRoute } from 'astro'
import { getInviteConfiguration } from '@/lib/invite/config'
import { getInviteIdentity } from '@/lib/invite/auth'
import { issueInviteGrant, inviteGrantState } from '@/lib/invite/grants'
import { hashInviteToken, inviteLinkToken } from '@/lib/invite/crypto'
import { hasInviteSchema } from '@/lib/invite/schema'
import {
  checkCreationRateLimit,
  createRateLimitResponse,
} from '@/lib/creation-rate-limiter'
import { resolveClientIp } from '@/lib/client-ip'
import { logger } from '@/lib/logger'

function result(kind: string, status: number, url?: string): Response {
  return Response.json(
    { kind, ...(url && { url }) },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    }
  )
}

export const POST: APIRoute = async context => {
  try {
    const config = getInviteConfiguration()
    if (!config || !(await hasInviteSchema())) return result('unavailable', 503)
    if (context.request.headers.get('origin') !== config.origin) {
      return result('forbidden', 403)
    }
    const limit = checkCreationRateLimit(
      'inviteIssue',
      resolveClientIp(context)
    )
    if (!limit.allowed) return createRateLimitResponse(limit.retryAfterMs)
    const identity = await getInviteIdentity(context.request, config)
    if (!identity) return result('login_required', 401)
    const issue = await issueInviteGrant(identity, config.identitySecret)
    if (issue.kind === 'quota_exhausted') return result(issue.kind, 409)
    if (issue.kind === 'campaign_disabled') return result(issue.kind, 409)
    if (issue.kind === 'unavailable') return result(issue.kind, 503)
    const state = await inviteGrantState(issue.grant)
    if (state.kind !== 'available') return result(state.kind, 200)
    const token = inviteLinkToken(config.identitySecret, identity)
    if (hashInviteToken(token) !== issue.grant.tokenHash) {
      return result('unavailable', 503)
    }
    return result('available', 200, `/invite/${token}`)
  } catch {
    logger.warn('[invite] Invitation issuance unavailable')
    return result('unavailable', 503)
  }
}
