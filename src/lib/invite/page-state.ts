import { getInviteConfiguration } from './config'
import { getInviteDisplayProfile } from './auth'
import { findInviteGrant, inviteGrantState } from './grants'
import { hashInviteToken, inviteLinkToken } from './crypto'
import { hasInviteSchema, requireInviteSchemaKey } from './schema'
import type { InviteProvider } from './types'
import { logger } from '@/lib/logger'

export type InvitePageState =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'login'; readonly providers: readonly InviteProvider[] }
  | { readonly kind: 'prepare' }
  | {
      readonly kind: 'available'
      readonly url: string
      readonly ticketCode: string
      readonly provider: InviteProvider
      readonly username: string | null
    }
  | { readonly kind: 'processing'; readonly username: string }
  | { readonly kind: 'completed'; readonly username: string }

export async function getInvitePageState(
  request: Request
): Promise<InvitePageState> {
  const config = getInviteConfiguration()
  if (!config || Object.keys(config.providers).length === 0) {
    return { kind: 'unavailable' }
  }
  try {
    if (!(await hasInviteSchema())) return { kind: 'unavailable' }
    await requireInviteSchemaKey(config.identitySecret)
    const profile = await getInviteDisplayProfile(request, config)
    if (!profile) {
      return {
        kind: 'login',
        providers: (['github', 'twitter'] as const).filter(
          provider => config.providers[provider]
        ),
      }
    }
    const identity = profile.identity
    const grant = await findInviteGrant(identity)
    if (!grant) return { kind: 'prepare' }
    const state = await inviteGrantState(grant)
    if (state.kind !== 'available') return state
    const token = inviteLinkToken(config.identitySecret, identity)
    return hashInviteToken(token) === grant.tokenHash
      ? {
          kind: 'available',
          url: `${config.origin}/invite/${token}`,
          ticketCode: grant.ticketCode,
          provider: identity.provider,
          username: profile.username,
        }
      : { kind: 'unavailable' }
  } catch {
    logger.warn('[invite] Invitation page unavailable')
    return { kind: 'unavailable' }
  }
}
