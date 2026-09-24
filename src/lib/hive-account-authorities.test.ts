import { describe, expect, it } from 'vitest'
import {
  authoritiesFromHiveAccount,
  hiveAuthoritiesMatchExpected,
} from '@/lib/hive-account-authorities'
import {
  hiveTransactionFromAttempt,
  hiveTransactionFromRecoveredAttempt,
} from '@/lib/creation-attempts'
import {
  CREATION_ATTEMPT_STATUS,
  HIVE_TX_MODE_VALUES,
} from '@/consts/hive-execution'
import type { CreationAttempt } from '@/lib/creation-attempts'

const KEYS = {
  ownerPublicKey: 'STM7owner',
  activePublicKey: 'STM7active',
  postingPublicKey: 'STM7posting',
  memoPublicKey: 'STM7memo',
}

describe('hive account authorities', () => {
  it('extracts sole keys from array and object auths', () => {
    const fromArrays = authoritiesFromHiveAccount({
      owner: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [['STM7owner', 1]],
      },
      active: {
        weight_threshold: 1,
        account_auths: {},
        key_auths: [['STM7active', 1]],
      },
      posting: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [['STM7posting', 1]],
      },
      memo_key: 'STM7memo',
    })
    expect(fromArrays).toEqual({
      ownerKey: 'STM7owner',
      activeKey: 'STM7active',
      postingKey: 'STM7posting',
      memoKey: 'STM7memo',
    })

    const fromObjects = authoritiesFromHiveAccount({
      owner: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: { STM7owner: 1 },
      },
      active: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: { STM7active: 1 },
      },
      posting: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: { STM7posting: 1 },
      },
      memo_key: 'STM7memo',
    })
    expect(fromObjects?.ownerKey).toBe('STM7owner')
  })

  it('rejects multi-key authorities as ambiguous', () => {
    expect(
      authoritiesFromHiveAccount({
        owner: {
          weight_threshold: 1,
          account_auths: [],
          key_auths: [
            ['STM7owner', 1],
            ['STM7other', 1],
          ],
        },
        active: {
          weight_threshold: 1,
          account_auths: [],
          key_auths: [['STM7active', 1]],
        },
        posting: {
          weight_threshold: 1,
          account_auths: [],
          key_auths: [['STM7posting', 1]],
        },
        memo_key: 'STM7memo',
      })
    ).toBeNull()
  })

  it('rejects authorities that are not the created-account shape', () => {
    const valid = {
      owner: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [['STM7owner', 1]],
      },
      active: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [['STM7active', 1]],
      },
      posting: {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [['STM7posting', 1]],
      },
      memo_key: 'STM7memo',
    }
    expect(authoritiesFromHiveAccount(valid)).not.toBeNull()
    expect(
      authoritiesFromHiveAccount({
        ...valid,
        owner: {
          weight_threshold: 2,
          account_auths: [],
          key_auths: [['STM7owner', 1]],
        },
      })
    ).toBeNull()
    expect(
      authoritiesFromHiveAccount({
        ...valid,
        active: {
          weight_threshold: 1,
          account_auths: [['alice', 1]],
          key_auths: [['STM7active', 1]],
        },
      })
    ).toBeNull()
    expect(
      authoritiesFromHiveAccount({
        ...valid,
        posting: {
          weight_threshold: 1,
          account_auths: [],
          key_auths: [['STM7posting', 2]],
        },
      })
    ).toBeNull()
  })

  it('matches only when all four expected keys equal Hive authorities', () => {
    const authorities = {
      ownerKey: KEYS.ownerPublicKey,
      activeKey: KEYS.activePublicKey,
      postingKey: KEYS.postingPublicKey,
      memoKey: KEYS.memoPublicKey,
    }
    expect(hiveAuthoritiesMatchExpected(authorities, KEYS)).toBe(true)
    expect(
      hiveAuthoritiesMatchExpected(authorities, {
        ...KEYS,
        ownerPublicKey: 'STM7other',
      })
    ).toBe(false)
  })
})

describe('hiveTransactionFromAttempt', () => {
  it('returns null without a persisted transaction id', () => {
    const attempt: CreationAttempt = {
      correlationId: 'corr-1',
      username: 'alice',
      ticket: 'TICKET01ABCDEF',
      ticketId: 1,
      fundingSource: 'builder_credits',
      ownerBuilderUsername: 'alice',
      status: CREATION_ATTEMPT_STATUS.RESERVED,
      keys: KEYS,
      transactionId: null,
      executionMode: HIVE_TX_MODE_VALUES.BROADCAST,
      broadcasted: false,
      wax: {
        validated: false,
        onChainVerified: false,
        signed: false,
        authorityVerified: false,
      },
      updatedAt: '2026-09-16T00:00:00Z',
    }
    expect(hiveTransactionFromAttempt(attempt)).toBeNull()
  })

  it('replays persisted tx id and wax flags instead of inventing a result', () => {
    const attempt: CreationAttempt = {
      correlationId: 'corr-1',
      username: 'alice',
      ticket: 'TICKET01ABCDEF',
      ticketId: 1,
      fundingSource: 'builder_credits',
      ownerBuilderUsername: 'alice',
      status: CREATION_ATTEMPT_STATUS.PREPARED,
      keys: KEYS,
      transactionId: 'real-tx-id',
      executionMode: HIVE_TX_MODE_VALUES.BROADCAST,
      broadcasted: true,
      wax: {
        validated: true,
        onChainVerified: true,
        signed: true,
        authorityVerified: false,
      },
      updatedAt: '2026-09-16T00:00:00Z',
    }
    const tx = hiveTransactionFromAttempt(attempt)
    expect(tx?.id).toBe('real-tx-id')
    expect(tx?.broadcasted).toBe(true)
    expect(tx?.wax.authorityVerified).toBe(false)
    expect(tx?.id.startsWith('recovered-')).toBe(false)
  })

  it('treats a Hive-matched recovery as broadcasted even if the flag was never persisted', () => {
    const attempt: CreationAttempt = {
      correlationId: 'corr-1',
      username: 'alice',
      ticket: 'TICKET01ABCDEF',
      ticketId: 1,
      fundingSource: 'builder_credits',
      ownerBuilderUsername: 'alice',
      status: CREATION_ATTEMPT_STATUS.PREPARED,
      keys: KEYS,
      transactionId: 'real-tx-id',
      executionMode: HIVE_TX_MODE_VALUES.BROADCAST,
      broadcasted: false,
      wax: {
        validated: true,
        onChainVerified: true,
        signed: true,
        authorityVerified: true,
      },
      updatedAt: '2026-09-16T00:00:00Z',
    }
    const tx = hiveTransactionFromRecoveredAttempt(attempt)
    expect(tx?.broadcasted).toBe(true)
    expect(tx?.id).toBe('real-tx-id')
  })
})
