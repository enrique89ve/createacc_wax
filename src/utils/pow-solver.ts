import { z } from 'astro/zod'
import { readApiResponse } from '@/utils/api-client'
import { POW_ENDPOINT_PARAMS, TIMING_TOKEN_PAIR_SIZE } from '@/consts/pow'
import {
  isPowWorkerResponse,
  type PowWorkerResponse,
} from '@/lib/pow-client/worker-contract'

interface PowChallenge {
  readonly challengeId: string
  readonly prefix: string
  readonly difficulty: number
  readonly expiresInMs: number
  readonly timingTokenId?: string
}

const PowChallengeSchema = z.looseObject({
  challengeId: z.string().regex(/^[\da-f]{32}$/u),
  prefix: z.string().regex(/^[\da-f]{32}$/u),
  difficulty: z.number().int().min(1).max(256),
  expiresAt: z.number().int().positive(),
  expiresInMs: z.number().int().positive(),
  timingTokenId: z.string().min(1).optional(),
})

const TimingTokenSchema = z.looseObject({
  timingTokenId: z.string().min(1),
})
const TimingTokenPairSchema = z.looseObject({
  timingTokenIds: z.tuple([z.string().min(1), z.string().min(1)]),
})

export interface PowSolution {
  readonly challengeId: string
  readonly nonce: string
}

export interface PowBundle {
  readonly pow: PowSolution
  readonly timingTokenId: string
  readonly tokenFetchedAt: number
}

const POW_CHALLENGE_ENDPOINT = '/api/pow/challenge'
const TIMING_TOKEN_ENDPOINT = '/api/pow/timing'
const FETCH_BUDGET_MS = 15_000
const FETCH_ATTEMPT_TIMEOUT_MS = 7_000
const MAX_FETCH_ATTEMPTS = 2
const RETRY_DELAY_MS = 250
const RETRY_JITTER_MS = 250
const MAIN_THREAD_SLICE_MS = 8

interface FetchedResponse {
  readonly response: Response
  readonly requestStartedAt: number
  readonly cleanup: () => void
}

type WorkerSolveResult =
  | { readonly status: 'solved'; readonly nonce: string }
  | { readonly status: 'expired' | 'cancelled' | 'unavailable' }

interface ActiveWorkerJob {
  readonly jobId: string
  readonly resolve: (result: WorkerSolveResult) => void
  readonly signal: AbortSignal | undefined
  readonly abortHandler: (() => void) | undefined
}

let powWorker: Worker | null = null
let activeWorkerJob: ActiveWorkerJob | null = null
let nextWorkerJobId = 0
let powSolveQueue: Promise<void> = Promise.resolve()

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('PoW operation cancelled')
}

function waitWithAbort(
  durationMs: number,
  signal: AbortSignal | undefined
): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal))

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => finish(), durationMs)
    const abortHandler = (): void => {
      if (signal) finish(abortError(signal))
    }

    function finish(error?: Error): void {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abortHandler)
      if (error) reject(error)
      else resolve()
    }

    signal?.addEventListener('abort', abortHandler, { once: true })
  })
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('Retry-After')
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000

  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) return null
  const serverDate = Date.parse(response.headers.get('Date') ?? '')
  const referenceTime = Number.isFinite(serverDate) ? serverDate : Date.now()
  return Math.max(0, retryAt - referenceTime)
}

function networkRetryDelayMs(): number {
  return RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_JITTER_MS)
}

/**
 * Fetch with one retry inside a single 15-second budget. Client errors stop
 * immediately; a 429 is retried only after its advertised Retry-After delay.
 */
async function fetchWithRetry(
  url: string,
  signal?: AbortSignal
): Promise<FetchedResponse> {
  const deadline = performance.now() + FETCH_BUDGET_MS
  let lastNetworkError: Error | undefined

  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw abortError(signal)

    const remainingMs = deadline - performance.now()
    if (remainingMs <= 0) break

    const requestStartedAt = performance.now()
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      Math.min(FETCH_ATTEMPT_TIMEOUT_MS, remainingMs)
    )
    const abortHandler = (): void => controller.abort(signal?.reason)
    const cleanup = (): void => {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abortHandler)
    }
    signal?.addEventListener('abort', abortHandler, { once: true })
    if (signal?.aborted) abortHandler()

    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal })
    } catch (error) {
      cleanup()
      if (signal?.aborted) throw abortError(signal)
      lastNetworkError =
        error instanceof Error ? error : new Error('PoW request failed')
      const retryDelay = networkRetryDelayMs()
      if (
        attempt + 1 >= MAX_FETCH_ATTEMPTS ||
        deadline - performance.now() <= retryDelay
      ) {
        break
      }
      await waitWithAbort(retryDelay, signal)
      continue
    }

    if (response.ok) return { response, requestStartedAt, cleanup }
    cleanup()

    if (response.status === 429) {
      const delayMs = retryAfterMs(response)
      const budgetAfterDelay = deadline - performance.now() - (delayMs ?? 0)
      if (
        attempt + 1 < MAX_FETCH_ATTEMPTS &&
        delayMs !== null &&
        delayMs > 0 &&
        budgetAfterDelay > 0
      ) {
        await waitWithAbort(delayMs, signal)
        continue
      }
    } else if (response.status >= 500 && attempt + 1 < MAX_FETCH_ATTEMPTS) {
      const remainingBudget = deadline - performance.now()
      if (remainingBudget > 0) {
        await waitWithAbort(
          Math.min(networkRetryDelayMs(), remainingBudget),
          signal
        )
        continue
      }
    }

    throw new Error(`PoW request rejected: ${response.status}`)
  }

  if (signal?.aborted) throw abortError(signal)
  throw lastNetworkError ?? new Error('PoW request timed out')
}

async function fetchPowChallenge(
  signal?: AbortSignal,
  includeTimingToken = false
): Promise<{
  readonly challenge: PowChallenge
  readonly challengeDeadlineAt: number
  readonly responseReceivedAt: number
}> {
  const url = includeTimingToken
    ? `${POW_CHALLENGE_ENDPOINT}?${POW_ENDPOINT_PARAMS.includeTimingToken}=${POW_ENDPOINT_PARAMS.enabled}`
    : POW_CHALLENGE_ENDPOINT
  const fetched = await fetchWithRetry(url, signal)
  try {
    const parsedResponse = await readApiResponse(
      fetched.response,
      PowChallengeSchema
    )
    if (!parsedResponse.ok) {
      throw new Error('Invalid PoW challenge response')
    }

    const responseReceivedAt = performance.now()
    const elapsedSinceRequestStart =
      responseReceivedAt - fetched.requestStartedAt
    const remainingMs =
      parsedResponse.data.expiresInMs - elapsedSinceRequestStart
    if (remainingMs <= 0) throw new Error('PoW challenge expired')

    return {
      challenge: parsedResponse.data,
      challengeDeadlineAt: responseReceivedAt + remainingMs,
      responseReceivedAt,
    }
  } finally {
    fetched.cleanup()
  }
}

function disposePowWorker(): void {
  if (!powWorker) return
  powWorker.onmessage = null
  powWorker.onerror = null
  powWorker.onmessageerror = null
  powWorker.terminate()
  powWorker = null
}

function finishWorkerJob(
  result: WorkerSolveResult,
  terminateWorker = false
): void {
  const job = activeWorkerJob
  activeWorkerJob = null
  if (job?.signal && job.abortHandler) {
    job.signal.removeEventListener('abort', job.abortHandler)
  }
  if (terminateWorker) disposePowWorker()
  job?.resolve(result)
}

function handleWorkerMessage(event: MessageEvent<unknown>): void {
  const job = activeWorkerJob
  if (!job) return

  if (!isPowWorkerResponse(event.data)) {
    finishWorkerJob({ status: 'unavailable' }, true)
    return
  }

  const response: PowWorkerResponse = event.data
  if (response.jobId !== job.jobId) return

  if (response.type === 'solved') {
    finishWorkerJob({ status: 'solved', nonce: response.nonce })
  } else if (response.reason === 'expired') {
    finishWorkerJob({ status: 'expired' })
  } else if (response.reason === 'cancelled') {
    finishWorkerJob({ status: 'cancelled' })
  } else {
    finishWorkerJob({ status: 'unavailable' }, true)
  }
}

function solveWithWorker(
  challenge: PowChallenge,
  remainingMs: number,
  signal: AbortSignal | undefined
): Promise<WorkerSolveResult> {
  if (typeof Worker === 'undefined' || activeWorkerJob) {
    return Promise.resolve({ status: 'unavailable' })
  }
  if (signal?.aborted) return Promise.resolve({ status: 'cancelled' })

  try {
    powWorker ??= new Worker(
      new URL('../workers/pow.worker.ts', import.meta.url),
      { type: 'module' }
    )
  } catch {
    disposePowWorker()
    return Promise.resolve({ status: 'unavailable' })
  }

  const worker = powWorker
  if (!worker) return Promise.resolve({ status: 'unavailable' })

  return new Promise(resolve => {
    nextWorkerJobId += 1
    const jobId = `${nextWorkerJobId.toString(36)}-${Math.floor(performance.now()).toString(36)}`
    const abortHandler = (): void =>
      finishWorkerJob({ status: 'cancelled' }, true)

    worker.onmessage = handleWorkerMessage
    worker.onerror = () => finishWorkerJob({ status: 'unavailable' }, true)
    worker.onmessageerror = () =>
      finishWorkerJob({ status: 'unavailable' }, true)

    activeWorkerJob = { jobId, resolve, signal, abortHandler }
    if (signal) signal.addEventListener('abort', abortHandler, { once: true })
    if (signal?.aborted) abortHandler()

    try {
      worker.postMessage({
        type: 'solve',
        jobId,
        prefix: challenge.prefix,
        difficulty: challenge.difficulty,
        remainingMs,
      })
    } catch {
      finishWorkerJob({ status: 'unavailable' }, true)
    }
  })
}

async function solveOnMainThread(
  challenge: PowChallenge,
  remainingMs: number,
  signal: AbortSignal | undefined
): Promise<string> {
  const { searchPowNonce } = await import('@/lib/pow-client/nonce-search')
  const result = await searchPowNonce({
    prefix: challenge.prefix,
    difficulty: challenge.difficulty,
    remainingMs,
    sliceMs: MAIN_THREAD_SLICE_MS,
    isCancelled: () => signal?.aborted ?? false,
  })

  if (result.status === 'solved') return result.nonce
  if (result.status === 'cancelled' && signal) throw abortError(signal)
  throw new Error('PoW challenge expired')
}

async function solvePowChallengeNow(
  challenge: PowChallenge,
  remainingMs: number,
  signal?: AbortSignal
): Promise<PowSolution> {
  if (signal?.aborted) throw abortError(signal)

  const workerResult = await solveWithWorker(challenge, remainingMs, signal)
  if (workerResult.status === 'solved') {
    return { challengeId: challenge.challengeId, nonce: workerResult.nonce }
  }
  if (workerResult.status === 'cancelled') {
    throw signal ? abortError(signal) : new Error('PoW operation cancelled')
  }
  if (workerResult.status === 'expired') {
    throw new Error('PoW challenge expired')
  }

  const nonce = await solveOnMainThread(challenge, remainingMs, signal)
  return { challengeId: challenge.challengeId, nonce }
}

function solvePowChallenge(
  challenge: PowChallenge,
  challengeDeadlineAt: number,
  signal?: AbortSignal
): Promise<PowSolution> {
  const queuedSolve = powSolveQueue.then(() => {
    const remainingMs = challengeDeadlineAt - performance.now()
    if (remainingMs <= 0) throw new Error('PoW challenge expired')
    return solvePowChallengeNow(challenge, remainingMs, signal)
  })
  powSolveQueue = queuedSolve.then(
    () => undefined,
    () => undefined
  )
  return queuedSolve
}

/** Fetches only a timing token to start the server-side timer. */
export async function fetchTimingToken(signal?: AbortSignal): Promise<string> {
  const fetched = await fetchWithRetry(TIMING_TOKEN_ENDPOINT, signal)
  try {
    const parsedResponse = await readApiResponse(
      fetched.response,
      TimingTokenSchema
    )
    if (!parsedResponse.ok) {
      throw new Error('Invalid timing token response')
    }
    return parsedResponse.data.timingTokenId
  } finally {
    fetched.cleanup()
  }
}

export async function fetchTimingTokenPair(
  signal?: AbortSignal
): Promise<readonly [string, string]> {
  const url = `${TIMING_TOKEN_ENDPOINT}?${POW_ENDPOINT_PARAMS.timingTokenCount}=${TIMING_TOKEN_PAIR_SIZE}`
  const fetched = await fetchWithRetry(url, signal)
  try {
    const parsedResponse = await readApiResponse(
      fetched.response,
      TimingTokenPairSchema
    )
    if (!parsedResponse.ok) {
      throw new Error('Invalid timing token pair response')
    }
    return parsedResponse.data.timingTokenIds
  } finally {
    fetched.cleanup()
  }
}

async function obtainSolvedChallenge(
  signal: AbortSignal | undefined,
  includeTimingToken: boolean
): Promise<{
  readonly pow: PowSolution
  readonly timingTokenId: string | undefined
  readonly tokenFetchedAt: number
}> {
  const { challenge, challengeDeadlineAt, responseReceivedAt } =
    await fetchPowChallenge(signal, includeTimingToken)
  const pow = await solvePowChallenge(challenge, challengeDeadlineAt, signal)
  return {
    pow,
    timingTokenId: challenge.timingTokenId,
    tokenFetchedAt: responseReceivedAt,
  }
}

/** Fetches and solves one fresh, single-use PoW challenge. */
export async function obtainPowSolution(options?: {
  readonly signal?: AbortSignal
}): Promise<PowSolution> {
  const { pow } = await obtainSolvedChallenge(options?.signal, false)
  return pow
}

/** Fetches one challenge and its timing token with a single round trip. */
export async function obtainPowBundle(options?: {
  readonly signal?: AbortSignal
}): Promise<PowBundle> {
  const { pow, timingTokenId, tokenFetchedAt } = await obtainSolvedChallenge(
    options?.signal,
    true
  )
  if (!timingTokenId) {
    throw new Error('PoW response did not include a timing token')
  }
  return { pow, timingTokenId, tokenFetchedAt }
}

function cancelPowWorker(): void {
  if (activeWorkerJob) {
    finishWorkerJob({ status: 'cancelled' }, true)
    return
  }
  disposePowWorker()
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', cancelPowWorker)
  document.addEventListener('astro:before-swap', cancelPowWorker)
}
