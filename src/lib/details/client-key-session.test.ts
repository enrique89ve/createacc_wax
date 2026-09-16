import { afterEach, describe, expect, it } from 'vitest'
import type { TPublicKey } from '@hiveio/wax'
import { HiveKeys, type KeyPair } from '@/lib/create/get-keys'
import type { HiveKeyRole } from '@/types/keys'
import {
  ClientKeySession,
  KEY_SESSION_PHASE,
  bindActiveKeySession,
  destroyActiveKeySession,
} from '@/lib/details/client-key-session'

const MASTER = 'P5MASTERSECRETVALUE'

function stubPair(role: HiveKeyRole, pub: string, priv: string): KeyPair {
  return {
    role,
    wifPrivateKey: priv,
    associatedPublicKey: pub,
    privateKey: priv,
    publicKey: pub as TPublicKey,
  }
}

function stubHiveKeys(): HiveKeys {
  return new HiveKeys(MASTER, [
    stubPair('owner', 'STM7ownerpub', '5Kownerprivsecret'),
    stubPair('active', 'STM7activepub', '5Kactiveprivsecret'),
    stubPair('posting', 'STM7postingpub', '5Kpostingprivsecret'),
    stubPair('memo', 'STM7memopub', '5Kmemoprivsecret'),
  ])
}

afterEach(() => {
  destroyActiveKeySession()
})

describe('ClientKeySession', () => {
  it('starts generated and exposes public keys without leaking privates in JSON', () => {
    const session = ClientKeySession.fromKeys(
      'alice',
      stubHiveKeys(),
      'alice_test'
    )
    expect(session.phase).toBe(KEY_SESSION_PHASE.GENERATED)
    expect(session.getPublicKeys().ownerPublicKey).toBe('STM7ownerpub')
    expect(JSON.stringify(session.getPublicKeys())).not.toContain(MASTER)
  })

  it('walks generate → backup → submit → destroy', () => {
    const session = ClientKeySession.fromKeys(
      'alice',
      stubHiveKeys(),
      'alice_test'
    )
    session.confirmBackup()
    expect(session.phase).toBe(KEY_SESSION_PHASE.BACKUP_CONFIRMED)
    session.markSubmitted()
    expect(session.phase).toBe(KEY_SESSION_PHASE.SUBMITTED)
    session.destroy()
    expect(session.phase).toBe(KEY_SESSION_PHASE.DESTROYED)
    expect(session.isAlive()).toBe(false)
    expect(() => session.revealMaster()).toThrow()
    expect(() => session.getPublicKeys()).toThrow()
  })

  it('createDownload stays in memory and does not change phase', () => {
    const session = ClientKeySession.fromKeys(
      'alice',
      stubHiveKeys(),
      'alice_test'
    )
    const download = session.createDownload()
    expect(download.masterKey).toBe(MASTER)
    expect(session.phase).toBe(KEY_SESSION_PHASE.GENERATED)
  })

  it('refuses submit without backup confirmation', () => {
    const session = ClientKeySession.fromKeys(
      'alice',
      stubHiveKeys(),
      'alice_test'
    )
    expect(() => session.markSubmitted()).toThrow()
  })

  it('bindActiveKeySession destroys the previous owner', () => {
    const first = ClientKeySession.fromKeys('alice', stubHiveKeys(), 'one')
    bindActiveKeySession(first)
    const second = ClientKeySession.fromKeys('bob', stubHiveKeys(), 'two')
    bindActiveKeySession(second)
    expect(first.phase).toBe(KEY_SESSION_PHASE.DESTROYED)
    expect(second.phase).toBe(KEY_SESSION_PHASE.GENERATED)
  })
})
