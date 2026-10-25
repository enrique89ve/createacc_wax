import { sha256 } from '@noble/hashes/sha2.js'

export type PowSearchResult =
  | { readonly status: 'solved'; readonly nonce: string }
  | { readonly status: 'expired' }
  | { readonly status: 'cancelled' }

export interface PowSearchOptions {
  readonly prefix: string
  readonly difficulty: number
  readonly remainingMs: number
  readonly sliceMs: number
  readonly isCancelled: () => boolean
}

function createPowCandidateMatcher(
  prefix: string,
  difficulty: number
): (nonce: string) => boolean {
  const prefixBytes = new TextEncoder().encode(prefix)
  const candidateBytes = new Uint8Array(prefixBytes.length + 16)
  candidateBytes.set(prefixBytes)

  return nonce => {
    for (let index = 0; index < nonce.length; index += 1) {
      candidateBytes[prefixBytes.length + index] = nonce.charCodeAt(index)
    }

    const digest = sha256(
      candidateBytes.subarray(0, prefixBytes.length + nonce.length)
    )
    const completeBytes = Math.floor(difficulty / 8)
    for (let index = 0; index < completeBytes; index += 1) {
      if (digest[index] !== 0) return false
    }

    const remainingBits = difficulty % 8
    if (remainingBits === 0) return true

    const mask = 0xff << (8 - remainingBits)
    return (digest[completeBytes] & mask) === 0
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

export async function searchPowNonce(
  options: PowSearchOptions
): Promise<PowSearchResult> {
  const { prefix, difficulty, remainingMs, sliceMs, isCancelled } = options
  if (
    prefix.length === 0 ||
    !Number.isInteger(difficulty) ||
    difficulty < 1 ||
    difficulty > 256 ||
    !Number.isFinite(remainingMs) ||
    remainingMs <= 0 ||
    !Number.isFinite(sliceMs) ||
    sliceMs <= 0
  ) {
    return { status: 'expired' }
  }

  const deadline = performance.now() + remainingMs
  const matches = createPowCandidateMatcher(prefix, difficulty)
  let counter = 0

  while (counter <= Number.MAX_SAFE_INTEGER) {
    const sliceStartedAt = performance.now()

    while (performance.now() - sliceStartedAt < sliceMs) {
      if (isCancelled()) return { status: 'cancelled' }
      if (performance.now() >= deadline) return { status: 'expired' }

      const nonce = counter.toString(16)
      if (matches(nonce)) return { status: 'solved', nonce }
      counter += 1
    }

    await yieldToEventLoop()
  }

  return { status: 'expired' }
}
