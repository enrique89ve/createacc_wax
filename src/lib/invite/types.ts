export const INVITE_PROVIDERS = ['github', 'twitter'] as const
export type InviteProvider = (typeof INVITE_PROVIDERS)[number]

export interface InviteIdentity {
  readonly provider: InviteProvider
  readonly identityHash: string
}

export interface InviteGrant extends InviteIdentity {
  readonly ticketId: number
  readonly ticketCode: string
  readonly tokenHash: string
  readonly issuedAt: string
}

export type InviteState =
  | { readonly kind: 'available'; readonly grant: InviteGrant }
  | { readonly kind: 'processing'; readonly username: string }
  | { readonly kind: 'completed'; readonly username: string }
  | { readonly kind: 'unavailable' }

export type InviteIssueResult =
  | { readonly kind: 'issued'; readonly grant: InviteGrant }
  | { readonly kind: 'existing'; readonly grant: InviteGrant }
  | { readonly kind: 'quota_exhausted' }
  | { readonly kind: 'campaign_disabled' }
  | { readonly kind: 'unavailable' }

export interface InviteCampaignSettings {
  readonly enabled: boolean
  readonly totalLimit: number
  readonly issuedCount: number
  readonly revision: number
}

export function isInviteProvider(value: unknown): value is InviteProvider {
  return value === 'github' || value === 'twitter'
}
