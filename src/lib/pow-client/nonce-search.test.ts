import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { searchPowNonce } from './nonce-search'

describe('searchPowNonce', () => {
  it('returns a nonce whose UTF-8 prefix and nonce hash meets difficulty', async () => {
    const prefix = 'prefix-é'
    const result = await searchPowNonce({
      prefix,
      difficulty: 8,
      remainingMs: 5_000,
      sliceMs: 1,
      isCancelled: () => false,
    })

    expect(result.status).toBe('solved')
    if (result.status !== 'solved') return

    const digest = createHash('sha256')
      .update(`${prefix}${result.nonce}`)
      .digest()
    expect(digest[0]).toBe(0)
  })

  it('honors cancellation before doing more work', async () => {
    await expect(
      searchPowNonce({
        prefix: 'prefix',
        difficulty: 18,
        remainingMs: 5_000,
        sliceMs: 8,
        isCancelled: () => true,
      })
    ).resolves.toEqual({ status: 'cancelled' })
  })

  it('rejects a challenge with no remaining lifetime', async () => {
    await expect(
      searchPowNonce({
        prefix: 'prefix',
        difficulty: 18,
        remainingMs: 0,
        sliceMs: 8,
        isCancelled: () => false,
      })
    ).resolves.toEqual({ status: 'expired' })
  })
})
