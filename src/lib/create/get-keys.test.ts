import { describe, expect, it } from 'vitest'
import type { TPublicKey } from '@hiveio/wax'
import { HiveKeys, type KeyPair } from '@/lib/create/get-keys'
import type { HiveKeyRole } from '@/types/keys'

const MASTER = 'P5MASTERSECRETVALUE'
const OWNER_PRIV = '5Kownerprivsecret'
const ACTIVE_PRIV = '5Kactiveprivsecret'
const POSTING_PRIV = '5Kpostingprivsecret'
const MEMO_PRIV = '5Kmemoprivsecret'

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
    stubPair('owner', 'STM7ownerpub', OWNER_PRIV),
    stubPair('active', 'STM7activepub', ACTIVE_PRIV),
    stubPair('posting', 'STM7postingpub', POSTING_PRIV),
    stubPair('memo', 'STM7memopub', MEMO_PRIV),
  ])
}

describe('HiveKeys public boundary', () => {
  it('publicKeys() returns only the four public keys', () => {
    const keys = stubHiveKeys()
    expect(keys.publicKeys()).toEqual({
      ownerPublicKey: 'STM7ownerpub',
      activePublicKey: 'STM7activepub',
      postingPublicKey: 'STM7postingpub',
      memoPublicKey: 'STM7memopub',
    })
  })

  it('JSON.stringify emits only public keys', () => {
    const serialized = JSON.stringify(stubHiveKeys())
    expect(serialized).not.toContain(MASTER)
    expect(serialized).not.toContain(OWNER_PRIV)
    expect(serialized).not.toContain(ACTIVE_PRIV)
    expect(serialized).not.toContain(POSTING_PRIV)
    expect(serialized).not.toContain(MEMO_PRIV)
    expect(JSON.parse(serialized)).toEqual({
      ownerPublicKey: 'STM7ownerpub',
      activePublicKey: 'STM7activepub',
      postingPublicKey: 'STM7postingpub',
      memoPublicKey: 'STM7memopub',
    })
  })

  it('toCreateAccountParams() never includes private material', () => {
    const params = stubHiveKeys().toCreateAccountParams('alice')
    const serialized = JSON.stringify(params)
    expect(serialized).not.toContain(MASTER)
    expect(serialized).not.toContain(OWNER_PRIV)
    expect(params).toEqual({
      username: 'alice',
      ownerPublicKey: 'STM7ownerpub',
      activePublicKey: 'STM7activepub',
      postingPublicKey: 'STM7postingpub',
      memoPublicKey: 'STM7memopub',
    })
  })
})
