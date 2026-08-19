import {
	KeyDownloadManager,
	type KeysData,
	type DownloadFormat,
} from '@/utils/key-download-manager'
import { obtainPowSolution, fetchTimingToken } from '@/utils/pow-solver'
import type { HiveKeyRole } from '@/types/keys'
import type { PreSolvedBundle } from './types'

export interface DownloadDependencies {
	readonly username: string
	readonly masterKey: string
	readonly allKeys: {
		getAllPrivateKeys(): Record<HiveKeyRole, string>
		getAllPublicKeys(): Record<HiveKeyRole, string>
	}
	readonly keysetId: string
	readonly recoverSession: () => Promise<boolean>
}

export async function downloadAndNotify(
	deps: DownloadDependencies,
	format: DownloadFormat,
): Promise<void> {
	const privateKeys = deps.allKeys.getAllPrivateKeys()
	const publicKeys = deps.allKeys.getAllPublicKeys()

	const keysData: KeysData = {
		username: deps.username,
		masterKey: deps.masterKey,
		privateKeys,
		publicKeys,
		keysetId: deps.keysetId,
		timestamp: new Date().toISOString(),
	}

	await KeyDownloadManager.downloadKeys(keysData, format)

	// Notify server about downloaded keys (best-effort)
	await notifyServerKeysDownloaded(publicKeys, deps.recoverSession)
}

async function notifyServerKeysDownloaded(
	publicKeys: Record<string, string>,
	recoverSession: () => Promise<boolean>,
): Promise<void> {
	const body = JSON.stringify({
		ownerPublicKey: publicKeys.owner,
		activePublicKey: publicKeys.active,
		postingPublicKey: publicKeys.posting,
		memoPublicKey: publicKeys.memo,
	})
	const headers = { 'Content-Type': 'application/json' }

	try {
		let res = await fetch('/api/create/keys-hash', {
			method: 'POST',
			headers,
			body,
		})

		if (res.status === 401) {
			const ok = await recoverSession()
			if (ok) {
				res = await fetch('/api/create/keys-hash', {
					method: 'POST',
					headers,
					body,
				})
			}
		}
	} catch {
		// Non-critical: server notification is best-effort; keys are already saved locally
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
