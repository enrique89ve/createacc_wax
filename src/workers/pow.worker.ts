import { searchPowNonce } from '@/lib/pow-client/nonce-search'
import {
  isPowWorkerRequest,
  type PowWorkerRequest,
  type PowWorkerResponse,
} from '@/lib/pow-client/worker-contract'

const cancelledJobs = new Set<string>()
let activeJobId: string | null = null

function postResponse(response: PowWorkerResponse): void {
  self.postMessage(response)
}

async function solve(request: Extract<PowWorkerRequest, { type: 'solve' }>) {
  if (activeJobId !== null) {
    postResponse({ type: 'failed', jobId: request.jobId, reason: 'busy' })
    return
  }

  activeJobId = request.jobId
  const result = await searchPowNonce({
    prefix: request.prefix,
    difficulty: request.difficulty,
    remainingMs: request.remainingMs,
    sliceMs: 24,
    isCancelled: () => cancelledJobs.has(request.jobId),
  })

  activeJobId = null
  cancelledJobs.delete(request.jobId)

  if (result.status === 'solved') {
    postResponse({
      type: 'solved',
      jobId: request.jobId,
      nonce: result.nonce,
    })
    return
  }

  postResponse({
    type: 'failed',
    jobId: request.jobId,
    reason: result.status,
  })
}

self.addEventListener('message', event => {
  const message: unknown = event.data
  if (!isPowWorkerRequest(message)) {
    postResponse({
      type: 'failed',
      jobId: 'invalid',
      reason: 'invalid_request',
    })
    return
  }

  if (message.type === 'cancel') {
    if (activeJobId === message.jobId) cancelledJobs.add(message.jobId)
    return
  }

  solve(message).catch(() => {
    if (activeJobId === message.jobId) activeJobId = null
    cancelledJobs.delete(message.jobId)
    postResponse({ type: 'failed', jobId: message.jobId, reason: 'expired' })
  })
})
