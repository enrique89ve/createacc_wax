import {
  KeyDownloadManager,
  type DownloadFormat,
} from '@/utils/key-download-manager'
import { obtainPowSolution, fetchTimingToken } from '@/utils/pow-solver'
import type { PublicKeySet } from '@/types/keys'
import type { ClientKeySession } from './client-key-session'
import type { PreSolvedBundle } from './types'
import { z } from 'astro/zod'
import { readApiResponse } from '@/utils/api-client'
import { HIVE_TX_MODE_VALUES } from '@/consts/hive-execution'

const KeyConfirmationSchema = z.looseObject({
  executionMode: z.enum([
    HIVE_TX_MODE_VALUES.SIMULATE,
    HIVE_TX_MODE_VALUES.BROADCAST,
  ]),
  creationIntentHash: z.string().regex(/^[0-9a-f]{64}$/u),
})

export async function initiateKeyDownload(
  keySession: ClientKeySession,
  format: DownloadFormat
): Promise<void> {
  const keysData = keySession.createDownload()
  await KeyDownloadManager.downloadKeys(keysData, format)
}

export type KeyConfirmationResult =
  | { readonly status: 'confirmed' }
  | { readonly status: 'session_recovery_failed' }
  | { readonly status: 'rejected' }
  | { readonly status: 'unavailable' }

export async function confirmKeysDownloaded(
  publicKeys: PublicKeySet,
  recoverSession: () => Promise<boolean>
): Promise<KeyConfirmationResult> {
  const body = JSON.stringify(publicKeys)
  const headers = { 'Content-Type': 'application/json' }

  let res: Response
  try {
    res = await fetch('/api/create/keys-hash', {
      method: 'POST',
      headers,
      body,
    })
  } catch {
    return { status: 'unavailable' }
  }

  if (res.status === 401) {
    let ok: boolean
    try {
      ok = await recoverSession()
    } catch {
      ok = false
    }
    if (!ok) {
      return { status: 'session_recovery_failed' }
    }
    try {
      res = await fetch('/api/create/keys-hash', {
        method: 'POST',
        headers,
        body,
      })
    } catch {
      return { status: 'unavailable' }
    }
  }

  if (!res.ok) return { status: 'rejected' }
  const result = await readApiResponse(res, KeyConfirmationSchema)
  return result.ok && result.meta !== null && res.status === 200
    ? { status: 'confirmed' }
    : { status: 'unavailable' }
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
