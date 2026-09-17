import { describe, expect, it } from 'vitest'
import {
  createHiveClaimAdapter,
  verifyTransactionPayload,
} from '@/lib/credits/adapters/hive-claim-adapter'

const USERNAME = 'builder'
const HASH = 'a'.repeat(64)
const TRANSACTION_ID = 'b'.repeat(64)
const NOW = Date.parse('2026-09-16T12:00:00.000Z')

function transactionWithOperations(
  operations: readonly unknown[],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    transaction_id: TRANSACTION_ID,
    timestamp: '2026-09-16T11:59:00.000Z',
    transaction_json: { operations },
    ...overrides,
  }
}

function claimOperation(json: string, auths: readonly string[] = [USERNAME]) {
  return {
    type: 'custom_json_operation',
    value: {
      id: 'claim_credits',
      json,
      required_posting_auths: auths,
    },
  }
}

function claimJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: 'holahiveCreateAcc',
    hash: HASH,
    username: USERNAME,
    timestamp: NOW,
    action: 'claim_credits',
    ...overrides,
  })
}

describe('Hive claim adapter', () => {
  it('returns the original operation index for a valid claim', () => {
    const result = verifyTransactionPayload(
      transactionWithOperations([
        { type: 'transfer_operation', value: {} },
        claimOperation(claimJson()),
      ]),
      { transactionId: TRANSACTION_ID, hash: HASH, username: USERNAME },
      NOW
    )

    expect(result).toEqual({
      ok: true,
      claim: {
        username: USERNAME,
        hash: HASH,
        transactionId: TRANSACTION_ID,
        operationIndex: 1,
        externalReference: `hive:claim:${TRANSACTION_ID}:1`,
      },
    })
  })

  it('continues after an invalid candidate and accepts a later valid one', () => {
    const result = verifyTransactionPayload(
      transactionWithOperations([
        claimOperation(claimJson({ hash: 'c'.repeat(64) })),
        claimOperation(claimJson()),
      ]),
      { transactionId: TRANSACTION_ID, hash: HASH, username: USERNAME },
      NOW
    )

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.claim.operationIndex).toBe(1)
  })

  it('rejects malformed identity, timestamps, and payloads', () => {
    const input = {
      transactionId: TRANSACTION_ID,
      hash: HASH,
      username: USERNAME,
    }
    expect(verifyTransactionPayload(null, input, NOW).ok).toBe(false)
    expect(
      verifyTransactionPayload(
        transactionWithOperations([claimOperation(claimJson())], {
          timestamp: 'not-a-date',
        }),
        input,
        NOW
      ).ok
    ).toBe(false)
    expect(
      verifyTransactionPayload(
        transactionWithOperations([claimOperation(claimJson())]),
        { ...input, hash: 'invalid' },
        NOW
      ).ok
    ).toBe(false)
  })

  it('rejects transactions outside the allowed clock window', () => {
    const input = {
      transactionId: TRANSACTION_ID,
      hash: HASH,
      username: USERNAME,
    }
    expect(
      verifyTransactionPayload(
        transactionWithOperations([claimOperation(claimJson())], {
          timestamp: '2026-09-16T10:00:00.000Z',
        }),
        input,
        NOW
      )
    ).toMatchObject({ ok: false, kind: 'invalid' })
    expect(
      verifyTransactionPayload(
        transactionWithOperations([claimOperation(claimJson())], {
          timestamp: '2026-09-16T12:01:00.000Z',
        }),
        input,
        NOW
      )
    ).toMatchObject({ ok: false, kind: 'invalid' })
  })

  it('distinguishes provider outages from invalid chain evidence', async () => {
    const adapter = createHiveClaimAdapter({
      getStatus: async () => {
        throw new Error('timeout')
      },
      getTransaction: async () => null,
    })

    await expect(
      adapter.verify({
        transactionId: TRANSACTION_ID,
        hash: HASH,
        username: USERNAME,
      })
    ).resolves.toMatchObject({ ok: false, kind: 'unavailable' })
  })

  it('returns pending before an included claim becomes irreversible', async () => {
    const adapter = createHiveClaimAdapter({
      getStatus: async () => ({ status: 'within_reversible_block' }),
      getTransaction: async () =>
        transactionWithOperations([claimOperation(claimJson())]),
    })

    await expect(
      adapter.verify(
        {
          transactionId: TRANSACTION_ID,
          hash: HASH,
          username: USERNAME,
        },
        NOW
      )
    ).resolves.toMatchObject({ ok: false, kind: 'pending' })
  })

  it('returns a verified claim only after Hive reports irreversible inclusion', async () => {
    const adapter = createHiveClaimAdapter({
      getStatus: async () => ({ status: 'within_irreversible_block' }),
      getTransaction: async () =>
        transactionWithOperations([claimOperation(claimJson())]),
    })

    await expect(
      adapter.verify(
        {
          transactionId: TRANSACTION_ID,
          hash: HASH,
          username: USERNAME,
        },
        NOW
      )
    ).resolves.toMatchObject({ ok: true })
  })

  it('keeps unknown and mempool transactions pending without reading the payload', async () => {
    let transactionReads = 0
    const adapter = createHiveClaimAdapter({
      getStatus: async () => ({ status: 'unknown' }),
      getTransaction: async () => {
        transactionReads += 1
        return null
      },
    })

    await expect(
      adapter.verify(
        {
          transactionId: TRANSACTION_ID,
          hash: HASH,
          username: USERNAME,
        },
        NOW
      )
    ).resolves.toMatchObject({ ok: false, kind: 'pending' })
    expect(transactionReads).toBe(0)
  })
})
