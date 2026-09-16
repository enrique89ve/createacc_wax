import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { initializeDatabase } from '@/lib/database'
import {
  consumeBuilderChallenge,
  createBuilderChallenge,
} from '@/lib/auth/builder-auth'

describe('builder auth challenges', () => {
  beforeAll(async () => {
    await initializeDatabase()
  })

  afterAll(async () => {
    const { db } = await import('@/lib/database')
    await db.execute({ sql: 'DELETE FROM BuilderAuthChallenges', args: [] })
  })

  it('consumes a nonce only once', async () => {
    const { nonce } = await createBuilderChallenge()
    expect(await consumeBuilderChallenge(nonce)).toBe(true)
    expect(await consumeBuilderChallenge(nonce)).toBe(false)
  })

  it('rejects an unknown nonce', async () => {
    expect(await consumeBuilderChallenge('0'.repeat(64))).toBe(false)
  })
})
