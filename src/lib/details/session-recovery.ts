import { TIMING_THRESHOLDS } from '@/consts/pow'
import { ensureTimingMatured } from '@/utils/timing-maturation'
import { obtainPowBundle } from '@/utils/pow-solver'
import { z } from 'astro/zod'
import { readApiResponse } from '@/utils/api-client'

export async function recoverCreationSessionForKeyConfirmation(
  username: string,
  ticket?: string,
  signal?: AbortSignal
): Promise<boolean> {
  try {
    if (!username) return false

    const { pow, timingTokenId, tokenFetchedAt } = await obtainPowBundle({
      signal,
    })
    await ensureTimingMatured(
      tokenFetchedAt,
      TIMING_THRESHOLDS.flow,
      100,
      signal
    )

    const response = await fetch('/api/create/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        pow,
        timingTokenId,
        ...(ticket ? { ticket } : {}),
      }),
      signal,
    })
    const result = await readApiResponse(
      response,
      z.looseObject({ username: z.literal(username) })
    )
    return response.status === 200 && result.ok && result.meta !== null
  } catch {
    return false
  }
}
