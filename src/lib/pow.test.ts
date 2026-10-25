import { afterEach, describe, expect, it, vi } from 'vitest'
import { DIFFICULTY } from '@/consts/pow'
import {
  generatePowChallenge,
  issueTimingTokenPair,
  validatePowSolution,
  validateTimingToken,
} from '@/lib/pow'
import { searchPowNonce } from '@/lib/pow-client/nonce-search'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('server PoW contract', () => {
  it('issues a relative lifetime and consumes a valid solution once', async () => {
    const challenge = generatePowChallenge()
    expect(challenge.expiresInMs).toBeGreaterThan(0)

    const result = await searchPowNonce({
      prefix: challenge.prefix,
      difficulty: challenge.difficulty,
      remainingMs: challenge.expiresInMs,
      sliceMs: 24,
      isCancelled: () => false,
    })
    expect(result.status).toBe('solved')
    if (result.status !== 'solved') return

    const solution = { challengeId: challenge.challengeId, nonce: result.nonce }
    expect(challenge.difficulty).toBe(DIFFICULTY)
    expect(validatePowSolution(solution)).toBe(true)
    expect(validatePowSolution(solution)).toBe(false)
  })

  it('rejects an expired challenge and consumes its id', () => {
    const challenge = generatePowChallenge()
    vi.spyOn(Date, 'now').mockReturnValue(challenge.expiresAt + 1)

    const solution = { challengeId: challenge.challengeId, nonce: '0' }
    expect(validatePowSolution(solution)).toBe(false)
    expect(validatePowSolution(solution)).toBe(false)
  })

  it('issues two distinct, independently consumable timing tokens', () => {
    const [firstToken, secondToken] = issueTimingTokenPair()

    expect(firstToken).not.toBe(secondToken)
    expect(validateTimingToken(firstToken, 0)).toBe(true)
    expect(validateTimingToken(secondToken, 0)).toBe(true)
    expect(validateTimingToken(firstToken, 0)).toBe(false)
  })
})
