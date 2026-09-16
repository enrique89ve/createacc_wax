import { HiveKeys } from '@/lib/create/get-keys'
import type { PublicKeySet } from '@/types/keys'
import type { KeysData } from '@/utils/key-download-manager'
import { KEYSET_SEPARATOR } from './types'

/**
 * Client Key Security invariants:
 * 1. Private keys never reach the server.
 * 2. Private keys never enter fetch().
 * 3. Private keys never enter cookies.
 * 4. Private keys never enter localStorage.
 * 5. Private keys never enter sessionStorage.
 * 6. Private keys never enter logs.
 * 7. Private keys never enter URLs/query strings.
 * 8. Private keys never enter analytics.
 * 9. They exist in memory only while the user needs them.
 * 10. The page that handles them runs the minimum JS possible.
 *
 * JS cannot guarantee physical RAM zeroization. destroy() drops
 * usable references so HolaHive no longer retains the secrets.
 */
export const KEY_SESSION_PHASE = {
	EMPTY: 'EMPTY',
	GENERATED: 'GENERATED',
	BACKUP_CONFIRMED: 'BACKUP_CONFIRMED',
	SUBMITTED: 'SUBMITTED',
	DESTROYED: 'DESTROYED',
} as const

export type KeySessionPhase =
	(typeof KEY_SESSION_PHASE)[keyof typeof KEY_SESSION_PHASE]

type AlivePhase =
	| typeof KEY_SESSION_PHASE.GENERATED
	| typeof KEY_SESSION_PHASE.BACKUP_CONFIRMED
	| typeof KEY_SESSION_PHASE.SUBMITTED

type SessionState =
	| { readonly phase: typeof KEY_SESSION_PHASE.EMPTY }
	| { readonly phase: typeof KEY_SESSION_PHASE.DESTROYED }
	| {
			readonly phase: AlivePhase
			readonly keys: HiveKeys
			readonly username: string
			readonly keysetId: string
	  }

const DEAD_SESSION_ERROR = 'Key session has no usable private key material'

function makeKeysetId(username: string): string {
	return `${username}${KEYSET_SEPARATOR}${Date.now().toString(36)}`
}

/**
 * Single authorized owner of private key material in the browser.
 */
export class ClientKeySession {
	#state: SessionState = { phase: KEY_SESSION_PHASE.EMPTY }

	static fromKeys(
		username: string,
		keys: HiveKeys,
		keysetId = makeKeysetId(username)
	): ClientKeySession {
		const session = new ClientKeySession()
		session.#state = {
			phase: KEY_SESSION_PHASE.GENERATED,
			keys,
			username,
			keysetId,
		}
		return session
	}

	static async generate(username: string): Promise<ClientKeySession> {
		const keys = await HiveKeys.generate(username)
		return ClientKeySession.fromKeys(username, keys)
	}

	get phase(): KeySessionPhase {
		return this.#state.phase
	}

	get username(): string {
		return this.#state.phase === KEY_SESSION_PHASE.EMPTY ||
			this.#state.phase === KEY_SESSION_PHASE.DESTROYED
			? ''
			: this.#state.username
	}

	get keysetId(): string {
		return this.#state.phase === KEY_SESSION_PHASE.EMPTY ||
			this.#state.phase === KEY_SESSION_PHASE.DESTROYED
			? ''
			: this.#state.keysetId
	}

	isAlive(): boolean {
		return (
			this.#state.phase === KEY_SESSION_PHASE.GENERATED ||
			this.#state.phase === KEY_SESSION_PHASE.BACKUP_CONFIRMED ||
			this.#state.phase === KEY_SESSION_PHASE.SUBMITTED
		)
	}

	getPublicKeys(): PublicKeySet {
		return this.#alive().keys.publicKeys()
	}

	revealMaster(): string {
		return this.#alive().keys.masterPrivateKey
	}

	createDownload(): KeysData {
		const alive = this.#alive()
		return {
			username: alive.username,
			masterKey: alive.keys.masterPrivateKey,
			privateKeys: alive.keys.getAllPrivateKeys(),
			publicKeys: alive.keys.getAllPublicKeys(),
			keysetId: alive.keysetId,
			timestamp: new Date().toISOString(),
		}
	}

	confirmBackup(): void {
		const alive = this.#alive()
		if (alive.phase === KEY_SESSION_PHASE.SUBMITTED) {
			throw new Error('Cannot confirm backup after submit')
		}
		this.#state = { ...alive, phase: KEY_SESSION_PHASE.BACKUP_CONFIRMED }
	}

	markSubmitted(): void {
		const alive = this.#alive()
		if (alive.phase !== KEY_SESSION_PHASE.BACKUP_CONFIRMED) {
			throw new Error('Submit requires a confirmed backup')
		}
		this.#state = { ...alive, phase: KEY_SESSION_PHASE.SUBMITTED }
	}

	destroy(): void {
		this.#state = { phase: KEY_SESSION_PHASE.DESTROYED }
	}

	#alive(): Extract<SessionState, { phase: AlivePhase }> {
		if (
			this.#state.phase === KEY_SESSION_PHASE.EMPTY ||
			this.#state.phase === KEY_SESSION_PHASE.DESTROYED
		) {
			throw new Error(DEAD_SESSION_ERROR)
		}
		return this.#state
	}
}

let activeSession: ClientKeySession | null = null

export function bindActiveKeySession(session: ClientKeySession): void {
	if (activeSession && activeSession !== session) {
		activeSession.destroy()
	}
	activeSession = session
}

export function destroyActiveKeySession(): void {
	activeSession?.destroy()
	activeSession = null
}
