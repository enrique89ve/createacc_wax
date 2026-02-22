import { obtainPowSolution, type PowSolution } from '@/utils/pow-solver'
import { POW_MAX_AGE_MS, ensureTimingMatured } from '@/utils/timing-maturation'
import { TIMING_THRESHOLDS } from '@/consts/pow'
import type { FormState } from './types'

export type SessionCreationResult =
	| { readonly success: true }
	| { readonly success: false; readonly error: string }

export async function createSession(
	username: string,
	ticket: string,
	pow: PowSolution,
	timingTokenId: string,
): Promise<SessionCreationResult> {
	const response = await fetch('/api/create/session', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username, ticket, pow, timingTokenId }),
	})
	const result = await response.json()
	if (response.ok && result.success) {
		return { success: true }
	}
	return { success: false, error: result.error || 'Error al crear la sesión' }
}

export type ResolvedSubmitData =
	| { readonly status: 'resolved'; readonly pow: PowSolution; readonly timingTokenId: string }
	| { readonly status: 'pow_error' }
	| { readonly status: 'timing_error' }

export interface SubmitDeps {
	readonly state: FormState
	readonly ensureSessionTimingToken: () => Promise<string>
}

export async function resolveSubmitDependencies(
	deps: SubmitDeps,
): Promise<ResolvedSubmitData> {
	const { state, ensureSessionTimingToken } = deps

	const isPowFresh = state.preSolvedPow
		&& (Date.now() - state.preSolvedPowAt) < POW_MAX_AGE_MS
	let pow: PowSolution | null
	try {
		pow = isPowFresh
			? await state.preSolvedPow
			: await obtainPowSolution()
	} catch {
		return { status: 'pow_error' }
	}
	state.preSolvedPow = null
	if (!pow) return { status: 'pow_error' }

	let timingTokenId: string
	try {
		timingTokenId = await ensureSessionTimingToken()
	} catch {
		return { status: 'timing_error' }
	}

	await ensureTimingMatured(
		state.sessionTimingTokenFetchedAt,
		TIMING_THRESHOLDS.session,
	)

	return { status: 'resolved', pow, timingTokenId }
}
