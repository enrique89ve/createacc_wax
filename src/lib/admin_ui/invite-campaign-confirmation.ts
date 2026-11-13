export const INVITE_CAMPAIGN_LIMIT_MAX = 1_000_000

export type InviteCampaignAction = 'activate' | 'pause' | 'update'

export type InviteCampaignDraft = {
  readonly savedEnabled: boolean
  readonly nextEnabled: boolean
  readonly savedLimit: number
  readonly nextLimit: number
  readonly providerReady: boolean
}

export type InviteCampaignDecision =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'invalid_limit' }
  | { readonly kind: 'providers_required' }
  | { readonly kind: 'confirm'; readonly action: InviteCampaignAction }

export function decideInviteCampaignChange(
  draft: InviteCampaignDraft
): InviteCampaignDecision {
  if (
    !Number.isSafeInteger(draft.nextLimit) ||
    draft.nextLimit < 0 ||
    draft.nextLimit > INVITE_CAMPAIGN_LIMIT_MAX
  ) {
    return { kind: 'invalid_limit' }
  }

  const sameEnabled = draft.savedEnabled === draft.nextEnabled
  const sameLimit = draft.savedLimit === draft.nextLimit
  if (sameEnabled && sameLimit) return { kind: 'unchanged' }
  if (draft.nextEnabled && draft.nextLimit === 0) {
    return { kind: 'invalid_limit' }
  }
  if (draft.nextEnabled && !draft.providerReady) {
    return { kind: 'providers_required' }
  }
  if (!sameEnabled) {
    return {
      kind: 'confirm',
      action: draft.nextEnabled ? 'activate' : 'pause',
    }
  }
  return { kind: 'confirm', action: 'update' }
}

/** Exact match, including case. A trimmed or lowercased word does not confirm. */
export function matchesConfirmationPhrase(
  typed: string,
  phrase: string
): boolean {
  return phrase.length > 0 && typed === phrase
}
