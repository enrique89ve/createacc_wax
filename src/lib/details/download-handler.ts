import {
  KeyDownloadManager,
  type DownloadFormat,
} from '@/utils/key-download-manager'
import { obtainPowSolution, fetchTimingToken } from '@/utils/pow-solver'
import type { PublicKeySet } from '@/types/keys'
import type { ClientKeySession } from './client-key-session'
import type { PreSolvedBundle } from './types'

export interface DownloadDependencies {
  readonly keySession: ClientKeySession
  readonly recoverSession: () => Promise<boolean>
}

export async function downloadAndNotify(
  deps: DownloadDependencies,
  format: DownloadFormat
): Promise<void> {
  const keysData = deps.keySession.createDownload()
  await KeyDownloadManager.downloadKeys(keysData, format)
  await notifyServerKeysDownloaded(
    deps.keySession.getPublicKeys(),
    deps.recoverSession
  )
}

async function notifyServerKeysDownloaded(
  publicKeys: PublicKeySet,
  recoverSession: () => Promise<boolean>
): Promise<void> {
  const body = JSON.stringify(publicKeys)
  const headers = { 'Content-Type': 'application/json' }

  let res = await fetch('/api/create/keys-hash', {
    method: 'POST',
    headers,
    body,
  })

  if (res.status === 401) {
    const ok = await recoverSession()
    if (!ok) {
      throw new Error('Session expired — could not confirm key download')
    }
    res = await fetch('/api/create/keys-hash', {
      method: 'POST',
      headers,
      body,
    })
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(
      detail.trim() || `Server rejected key download confirmation (${res.status})`
    )
  }
}

export async function preSolvePowBundle(): Promise<PreSolvedBundle | null> {
  try {
    let tokenFetchedAt = 0
    const [pow, timingTokenId] = await Promise.all([
      obtainPowSolution(),
      fetchTimingToken()
        .then(id => {
          tokenFetchedAt = Date.now()
          return id
        })
        .catch(() => {
          tokenFetchedAt = Date.now()
          return undefined
        }),
    ])
    return { pow, timingTokenId, tokenFetchedAt, solvedAt: Date.now() }
  } catch {
    return null
  }
}
