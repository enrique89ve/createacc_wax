import { obtainPowSolution, fetchTimingToken, type PowSolution } from '@/utils/pow-solver'
import { TIMING_FLOOR_MS, CHALLENGE_TTL_MS } from '@/consts/pow'
import type { PreSolvedBundle } from './types'

/** Discard pre-solved PoW after 4min (challenge TTL is 5min on server). */
const POW_MAX_AGE_MS = CHALLENGE_TTL_MS - 60_000

interface ResolvedPow {
	readonly pow: PowSolution
	readonly timingTokenId: string
}

/**
 * Wait until a timing token has matured (server requires >=TIMING_FLOOR_MS).
 */
async function ensureTokenMatured(fetchedAt: number): Promise<void> {
	const elapsed = Date.now() - fetchedAt
	if (elapsed < TIMING_FLOOR_MS) {
		await new Promise(resolve => setTimeout(resolve, TIMING_FLOOR_MS - elapsed))
	}
}

/**
 * Resolve PoW + timing token from a pre-solved bundle or fetch fresh ones.
 */
export async function resolvePow(
	preSolvedBundle: Promise<PreSolvedBundle | null> | null,
): Promise<ResolvedPow> {
	const rawBundle = preSolvedBundle ? await preSolvedBundle : null
	const bundle = rawBundle && (Date.now() - rawBundle.solvedAt) < POW_MAX_AGE_MS
		? rawBundle
		: null

	if (bundle) {
		if (!bundle.timingTokenId) {
			throw new Error('Timing token missing from pre-solved bundle')
		}
		await ensureTokenMatured(bundle.tokenFetchedAt)
		return { pow: bundle.pow, timingTokenId: bundle.timingTokenId }
	}

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

	if (!timingTokenId) {
		throw new Error('Failed to obtain timing token')
	}

	await ensureTokenMatured(tokenFetchedAt)
	return { pow, timingTokenId }
}

export type AccountCreationResult =
	| { readonly success: true; readonly transactionId: string }
	| { readonly success: false; readonly error: string }

/**
 * Call the account creation API endpoint.
 */
export async function submitAccountCreation(
	username: string,
	publicKeys: Record<string, string>,
	pow: PowSolution,
	timingTokenId: string,
): Promise<AccountCreationResult> {
	const response = await fetch('/api/create/account', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			username,
			ownerPublicKey: publicKeys.owner,
			activePublicKey: publicKeys.active,
			postingPublicKey: publicKeys.posting,
			memoPublicKey: publicKeys.memo,
			pow,
			timingTokenId,
		}),
	})

	const result = await response.json()

	if (response.ok && result.success) {
		return { success: true, transactionId: result.transactionId ?? '' }
	}

	return { success: false, error: result.error || 'Error al crear la cuenta' }
}
