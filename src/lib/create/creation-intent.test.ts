import { describe, expect, it } from 'vitest'
import { createContext } from 'astro/middleware'
import {
  hashCreationIntent,
  hashConfirmedPublicKeys,
} from './confirmed-public-keys'
import { validateSessionData } from './account-creation.validator'
import { getCreationCookie, setCreationCookie } from '@/lib/session-cookies'
import { CREATION_SESSION_CONFIG } from '@/consts/constants'
import type { CreationSession } from '@/types/auth'
import type { HiveExecutionMode } from '@/consts/hive-execution'

const publicKeys = {
  ownerPublicKey: 'STMowner',
  activePublicKey: 'STMactive',
  postingPublicKey: 'STMposting',
  memoPublicKey: 'STMmemo',
}
const intent = {
  username: 'alice',
  ticket: 'TICKET-1',
  executionMode: 'simulate',
  publicKeys,
} as const
function session(
  executionMode: HiveExecutionMode = 'simulate'
): CreationSession {
  return {
    username: intent.username,
    ticket: intent.ticket,
    executionMode,
    confirmedDownload: true,
    confirmedPublicKeysHash: hashConfirmedPublicKeys(publicKeys),
    creationIntentHash: hashCreationIntent({ ...intent, executionMode }),
  }
}
describe('authenticated creation intent', () => {
  it.each(['simulate', 'broadcast'] as const)(
    'accepts an unchanged %s session',
    mode => {
      expect(
        validateSessionData(session(mode), 'alice', publicKeys, mode).success
      ).toBe(true)
    }
  )
  it.each(['simulate', 'broadcast'] as const)(
    'rejects a %s session replayed in the other mode',
    mode => {
      const otherMode = mode === 'simulate' ? 'broadcast' : 'simulate'
      expect(
        validateSessionData(session(mode), 'alice', publicKeys, otherMode)
          .success
      ).toBe(false)
    }
  )
  it('binds every public key, username, ticket and mode', () => {
    const original = hashCreationIntent(intent)
    for (const field of Object.keys(publicKeys)) {
      expect(
        hashCreationIntent({
          ...intent,
          publicKeys: { ...publicKeys, [field]: 'STMchanged' },
        })
      ).not.toBe(original)
    }
    expect(hashCreationIntent({ ...intent, username: 'bob' })).not.toBe(
      original
    )
    expect(hashCreationIntent({ ...intent, ticket: 'TICKET-2' })).not.toBe(
      original
    )
    expect(
      hashCreationIntent({ ...intent, executionMode: 'broadcast' })
    ).not.toBe(original)
    expect(hashCreationIntent({ ...intent, ticket: ' ticket-1 ' })).toBe(
      original
    )
  })
  it('rejects ticket replacement and legacy sessions without a binding', () => {
    expect(
      validateSessionData(
        { ...session(), ticket: 'TICKET-2' },
        'alice',
        publicKeys,
        'simulate'
      ).success
    ).toBe(false)
    expect(
      validateSessionData(
        { ...session(), creationIntentHash: undefined },
        'alice',
        publicKeys,
        'simulate'
      ).success
    ).toBe(false)
  })
  it('rejects a changed mode and recomputed hash when the cookie signature is unchanged', () => {
    const ctx = createContext({
      request: new Request('https://localhost/'),
      params: {},
      defaultLocale: 'en',
    })
    setCreationCookie(ctx.cookies, session(), ctx.request)
    const original = ctx.cookies.get(CREATION_SESSION_CONFIG.COOKIE_NAME)?.value
    expect(original).toBeDefined()
    if (!original) throw new Error('Missing test cookie')
    const signature = original.split('.')[1]
    const forged = Buffer.from(JSON.stringify(session('broadcast'))).toString(
      'base64url'
    )
    ctx.cookies.set(
      CREATION_SESSION_CONFIG.COOKIE_NAME,
      `${forged}.${signature}`
    )
    expect(getCreationCookie(ctx.cookies)).toBeNull()
  })
})
