/**
 * Hive Signature Verifier - Verificación criptográfica de firmas de Keychain
 * Valida que la firma corresponde al mensaje y usuario específico
 */

import { createWaxFoundation } from '@hiveio/wax'
import { hiveChain } from '@/lib/hiveservice'
import type { IHiveChainInterface } from '@hiveio/wax'
import { createHash } from 'node:crypto'
import type {
	HiveSignatureVerificationRequest,
	HiveSignatureVerificationResult,
	HiveUsername,
	HivePublicKey,
	HiveSignatureErrorCode,
} from '@/types/hive-signature'
import { createHiveUsername, createHivePublicKey } from '@/types/hive-signature'

export type SignatureVerificationParams = HiveSignatureVerificationRequest
export type SignatureVerificationResult = HiveSignatureVerificationResult

type PostingKeyAuth = readonly [string, number]

interface AccountLookupResult {
	readonly found: boolean
	readonly postingKeyAuths: readonly PostingKeyAuth[]
	readonly error?: string
}

export class HiveSignatureVerifier {
	private chain: IHiveChainInterface | null = null

	private async ensureChainConnection(): Promise<IHiveChainInterface> {
		if (!this.chain) {
			this.chain = await hiveChain()
		}
		return this.chain
	}

	private createErrorResult(
		code: HiveSignatureErrorCode,
		message: string
	): HiveSignatureVerificationResult {
		return {
			valid: false,
			error: `[${code}] ${message}`,
		}
	}

	async verifyMessageSignature(
		params: HiveSignatureVerificationRequest
	): Promise<HiveSignatureVerificationResult> {
		const { username, message, publicKey, signature } = params

		try {
			if (!username || !message) {
				return this.createErrorResult(
					'INVALID_USERNAME',
					'Username y message son requeridos'
				)
			}

			if (!signature || signature.length < 128 || signature.length > 140) {
				return this.createErrorResult(
					'INVALID_SIGNATURE',
					'Signature requerida para verificación criptográfica'
				)
			}

			if (!publicKey) {
				return this.createErrorResult(
					'INVALID_SIGNATURE',
					'PublicKey es requerida para verificación'
				)
			}

			const hiveUsername = createHiveUsername(username)
			const hivePublicKey = createHivePublicKey(publicKey)

			// Verificar que el usuario existe y obtener sus posting keys
			const chain = await this.ensureChainConnection()
			const accountResult = await this.lookupPostingKeys(hiveUsername, chain)

			if (!accountResult.found) {
				return {
					valid: false,
					error: accountResult.error || 'Usuario no encontrado en Hive blockchain',
				}
			}

			// Verificar que la publicKey pertenece al usuario (posting authority)
			const { postingKeyAuths } = accountResult
			const publicKeyInAuthorities = postingKeyAuths.find(
				([key]) => key === hivePublicKey
			)
			if (!publicKeyInAuthorities) {
				return this.createErrorResult(
					'SIGNATURE_VERIFICATION_FAILED',
					'La clave pública proporcionada no pertenece al usuario'
				)
			}

			// Verificación criptográfica: recuperar public key desde firma y comparar
			return await this.verifySignatureCryptographically(
				message,
				signature,
				hivePublicKey,
				postingKeyAuths
			)
		} catch (error) {
			return {
				valid: false,
				error: `Error en verificación: ${error instanceof Error ? error.message : 'Error desconocido'}`,
			}
		}
	}

	/**
	 * Recupera la public key desde la firma y verifica que pertenece al usuario.
	 * Keychain firma un SHA-256 del mensaje challenge.
	 */
	private async verifySignatureCryptographically(
		message: string,
		signature: string,
		hivePublicKey: HivePublicKey,
		postingKeyAuths: readonly PostingKeyAuth[]
	): Promise<HiveSignatureVerificationResult> {
		const wax = await createWaxFoundation()

		try {
			const sigDigest = createHash('sha256').update(message).digest('hex')
			const recoveredKey = wax.getPublicKeyFromSignature(sigDigest, signature)

			// Verificar que la key recuperada está en las posting key_auths del usuario
			const keyInAuthorities = postingKeyAuths.find(
				([key]) => key === recoveredKey
			)

			if (!keyInAuthorities) {
				return this.createErrorResult(
					'SIGNATURE_VERIFICATION_FAILED',
					'La firma no corresponde a ninguna clave posting del usuario'
				)
			}

			// Anti-inyección: la key enviada por el cliente debe coincidir con la recuperada
			if (recoveredKey !== hivePublicKey) {
				return this.createErrorResult(
					'PUBLIC_KEY_MISMATCH',
					'La clave pública enviada no coincide con la clave que generó la firma'
				)
			}

			return { valid: true }
		} finally {
			wax.delete()
		}
	}

	/**
	 * Busca la cuenta en Hive y extrae las posting key_auths directamente del API response.
	 * Evita castear el ApiAccount completo a tipos custom.
	 */
	private async lookupPostingKeys(
		username: HiveUsername,
		chain: IHiveChainInterface
	): Promise<AccountLookupResult> {
		try {
			const response = await chain.api.database_api.find_accounts({
				accounts: [username],
				delayed_votes_active: true,
			})

			if (response.accounts.length === 0) {
				return {
					found: false,
					postingKeyAuths: [],
					error: `Cuenta ${username} no encontrada en Hive blockchain`,
				}
			}

			const account = response.accounts[0]

			return {
				found: true,
				postingKeyAuths: account.posting.key_auths as unknown as PostingKeyAuth[],
			}
		} catch (error) {
			return {
				found: false,
				postingKeyAuths: [],
				error: `Error al verificar cuenta: ${error instanceof Error ? error.message : 'Error desconocido'}`,
			}
		}
	}
}

export const hiveSignatureVerifier = new HiveSignatureVerifier()

export async function quickVerifySignature(
	params: HiveSignatureVerificationRequest
): Promise<HiveSignatureVerificationResult> {
	return hiveSignatureVerifier.verifyMessageSignature(params)
}
