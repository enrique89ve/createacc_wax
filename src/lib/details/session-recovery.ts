import { TIMING_THRESHOLDS } from '@/consts/pow'
import { ensureTimingMatured } from '@/utils/timing-maturation'
import { fetchTimingToken, obtainPowSolution } from '@/utils/pow-solver'

export async function recoverCreationSessionForKeyConfirmation(
  username: string,
  ticket?: string
): Promise<boolean> {
  try {
    if (!username) return false

    let tokenFetchedAt = 0
    const [pow, timingTokenId] = await Promise.all([
      obtainPowSolution(),
      fetchTimingToken().then(id => {
        tokenFetchedAt = Date.now()
        return id
      }),
    ])
    await ensureTimingMatured(tokenFetchedAt, TIMING_THRESHOLDS.flow)

    const response = await fetch('/api/create/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        pow,
        timingTokenId,
        ...(ticket ? { ticket } : {}),
      }),
    })
    return response.ok
  } catch {
    return false
  }
}
