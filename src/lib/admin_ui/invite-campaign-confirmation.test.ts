import { describe, expect, it } from 'vitest'
import {
  decideInviteCampaignChange,
  matchesConfirmationPhrase,
  type InviteCampaignDraft,
} from './invite-campaign-confirmation'

const paused: InviteCampaignDraft = {
  savedEnabled: false,
  nextEnabled: false,
  savedLimit: 0,
  nextLimit: 0,
  providerReady: true,
}

describe('invite campaign confirmation', () => {
  it('asks for the activation phrase before a paused campaign can go live', () => {
    expect(
      decideInviteCampaignChange({
        ...paused,
        nextEnabled: true,
        nextLimit: 25,
      })
    ).toEqual({ kind: 'confirm', action: 'activate' })
  })

  it('asks to pause when an active campaign is turned off', () => {
    expect(
      decideInviteCampaignChange({
        ...paused,
        savedEnabled: true,
        savedLimit: 25,
        nextEnabled: false,
        nextLimit: 25,
      })
    ).toEqual({ kind: 'confirm', action: 'pause' })
  })

  it('confirms a cap change without treating it as an activation', () => {
    expect(
      decideInviteCampaignChange({
        ...paused,
        savedLimit: 10,
        nextLimit: 40,
      })
    ).toEqual({ kind: 'confirm', action: 'update' })
  })

  it('does nothing when the draft matches the saved campaign', () => {
    expect(decideInviteCampaignChange(paused)).toEqual({ kind: 'unchanged' })
  })

  it('refuses to activate with an empty cap or without a social provider', () => {
    expect(
      decideInviteCampaignChange({
        ...paused,
        nextEnabled: true,
        nextLimit: 0,
      })
    ).toEqual({ kind: 'invalid_limit' })
    expect(
      decideInviteCampaignChange({
        ...paused,
        nextEnabled: true,
        nextLimit: 10,
        providerReady: false,
      })
    ).toEqual({ kind: 'providers_required' })
  })

  it('still allows pausing when provider credentials are missing', () => {
    expect(
      decideInviteCampaignChange({
        ...paused,
        savedEnabled: true,
        savedLimit: 10,
        nextEnabled: false,
        nextLimit: 10,
        providerReady: false,
      })
    ).toEqual({ kind: 'confirm', action: 'pause' })
  })

  it('rejects a cap outside the allowed range', () => {
    expect(decideInviteCampaignChange({ ...paused, nextLimit: -1 })).toEqual({
      kind: 'invalid_limit',
    })
    expect(
      decideInviteCampaignChange({ ...paused, nextLimit: 1_000_001 })
    ).toEqual({ kind: 'invalid_limit' })
  })

  it('accepts only the exact confirmation word', () => {
    expect(matchesConfirmationPhrase('ACTIVAR', 'ACTIVAR')).toBe(true)
    expect(matchesConfirmationPhrase('activar', 'ACTIVAR')).toBe(false)
    expect(matchesConfirmationPhrase(' ACTIVAR', 'ACTIVAR')).toBe(false)
    expect(matchesConfirmationPhrase('', 'ACTIVAR')).toBe(false)
  })
})
