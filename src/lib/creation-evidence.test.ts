import { describe, expect, it, vi } from 'vitest'
import type { CreationAttempt } from '@/lib/creation-attempts'
import {
  evaluateHiveCreationEvidence,
  inspectHiveCreationEvidence,
} from '@/lib/creation-evidence'

const attempt: CreationAttempt = {
  correlationId: 'creation-evidence-1',
  username: 'newaccount',
  ticket: 'TICKET123',
  ticketId: 1,
  fundingSource: 'system',
  ownerBuilderUsername: null,
  version: 2,
  leaseToken: 'lease-token',
  leaseExpiresAt: '2026-09-24 12:00:00',
  leaseGeneration: 1,
  status: 'broadcasting',
  keys: {
    ownerPublicKey: 'STM7owner',
    activePublicKey: 'STM7active',
    postingPublicKey: 'STM7posting',
    memoPublicKey: 'STM7memo',
  },
  transactionId: 'a'.repeat(40),
  transactionExpiresAt: '2030-01-01T00:00:00',
  executionMode: 'broadcast',
  broadcasted: false,
  wax: {
    validated: true,
    onChainVerified: true,
    signed: true,
    authorityVerified: true,
  },
  updatedAt: '2026-09-24T12:00:00Z',
}

function hiveTransaction(ownerKey = attempt.keys.ownerPublicKey) {
  const authority = (key: string) => ({
    weight_threshold: 1,
    account_auths: [],
    key_auths: [[key, 1]],
  })
  return {
    transaction_id: attempt.transactionId,
    operations: [
      {
        type: 'create_claimed_account_operation',
        value: {
          new_account_name: attempt.username,
          owner: authority(ownerKey),
          active: authority(attempt.keys.activePublicKey),
          posting: authority(attempt.keys.postingPublicKey),
          memo_key: attempt.keys.memoPublicKey,
        },
      },
    ],
  }
}

describe('Hive creation evidence', () => {
  it('accepts only an irreversible transaction with the expected account and keys', () => {
    expect(
      evaluateHiveCreationEvidence({
        attempt,
        statusResult: { status: 'within_irreversible_block' },
        transactionResult: hiveTransaction(),
      })
    ).toEqual({
      kind: 'created',
      transactionId: attempt.transactionId,
      operationIndex: 0,
    })

    expect(
      evaluateHiveCreationEvidence({
        attempt,
        statusResult: { status: 'within_irreversible_block' },
        transactionResult: hiveTransaction('STM7unexpected'),
      })
    ).toMatchObject({ kind: 'review' })
  })

  it('keeps reversible and mempool states pending', () => {
    expect(
      evaluateHiveCreationEvidence({
        attempt,
        statusResult: { status: 'within_reversible_block' },
      })
    ).toEqual({ kind: 'pending', status: 'within_reversible_block' })
    expect(
      evaluateHiveCreationEvidence({
        attempt,
        statusResult: { status: 'within_mempool' },
      })
    ).toEqual({ kind: 'pending', status: 'within_mempool' })
  })

  it('allows a refund decision only after the exact persisted expiration is irreversible', () => {
    expect(
      evaluateHiveCreationEvidence({
        attempt,
        statusResult: { status: 'expired_irreversible' },
        now: Date.parse('2030-01-02T00:00:00Z'),
      })
    ).toEqual({
      kind: 'not_executed',
      transactionId: attempt.transactionId,
      status: 'expired_irreversible',
    })
    expect(
      evaluateHiveCreationEvidence({
        attempt,
        statusResult: { status: 'expired_irreversible' },
        now: Date.parse('2029-12-31T23:59:59Z'),
      })
    ).toMatchObject({ kind: 'review' })
    expect(
      evaluateHiveCreationEvidence({
        attempt,
        statusResult: { status: 'too_old' },
      })
    ).toMatchObject({ kind: 'review' })
  })

  it('queries Hive using the persisted txid and expiration before returning evidence', async () => {
    const getStatus = vi
      .fn()
      .mockResolvedValue({ status: 'expired_irreversible' })
    const provider = {
      getStatus,
      getTransaction: vi.fn(),
    }
    const result = await inspectHiveCreationEvidence(
      attempt,
      provider,
      Date.parse('2030-01-02T00:00:00Z')
    )
    expect(getStatus).toHaveBeenCalledWith({
      transactionId: attempt.transactionId,
      expiration: attempt.transactionExpiresAt,
    })
    expect(provider.getTransaction).not.toHaveBeenCalled()
    expect(result.kind).toBe('not_executed')
  })
})
