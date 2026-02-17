/**
 * Hive Signature Verifier - Verificación criptográfica real de firmas de Keychain
 * Valida criptográficamente que la firma corresponde al mensaje y usuario específico
 */

import { createWaxFoundation } from '@hiveio/wax'
import { hiveChain } from '@/lib/hiveservice'
import type { IHiveChainInterface, IWaxBaseInterface } from '@hiveio/wax'
import { createHash } from 'node:crypto'
import type {
  HiveSignatureVerificationRequest,
  HiveSignatureVerificationResult,
  HiveAccountVerificationResult,
  HiveUsername,
  HivePublicKey,
  HiveSignature,
  HiveAccountData,
  HiveSerializationType,
  HiveSignatureErrorCode,
} from '@/types/hive-signature'
import { createHiveUsername, createHivePublicKey } from '@/types/hive-signature'

// Legacy exports for backward compatibility
export type SignatureVerificationParams = HiveSignatureVerificationRequest
export type SignatureVerificationResult = HiveSignatureVerificationResult

export class HiveSignatureVerifier {
  private chain: IHiveChainInterface | null = null

  /**
   * Inicializa la conexión a Hive solo para verificación de cuenta
   */
  private async ensureChainConnection(): Promise<IHiveChainInterface> {
    if (!this.chain) {
      this.chain = await hiveChain()
    }
    return this.chain
  }

  /**
   * Crea un resultado de error tipado
   */
  private createErrorResult(
    code: HiveSignatureErrorCode,
    message: string
  ): HiveSignatureVerificationResult {
    return {
      valid: false,
      error: `[${code}] ${message}`,
    }
  }

  /**
   * Verifica la firma de un mensaje de manera criptográficamente segura
   * Maneja tanto transacciones JSON completas como mensajes de autenticación simples
   */
  async verifyMessageSignature(
    params: HiveSignatureVerificationRequest
  ): Promise<HiveSignatureVerificationResult> {
    const { username, message, publicKey, signature } = params

    try {
      // Validaciones básicas
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

      // Convertir a tipos branded
      const hiveUsername = createHiveUsername(username)
      const hiveSignature = signature as HiveSignature
      const hivePublicKey = createHivePublicKey(publicKey)

      // Verificar que el usuario existe en Hive blockchain
      const chain = await this.ensureChainConnection()
      const accountResult = await this.verifyHiveAccount(hiveUsername, chain)

      if (!accountResult.valid) {
        return {
          valid: false,
          error:
            accountResult.error || 'Usuario no encontrado en Hive blockchain',
        }
      }

      // PASO 1: Verificar que la publicKey pertenece al usuario
      const postingKeyAuths = accountResult.accountData?.posting.key_auths || []
      const publicKeyInAuthorities = postingKeyAuths.find(
        ([key]) => key === hivePublicKey
      )
      if (!publicKeyInAuthorities) {
        return this.createErrorResult(
          'SIGNATURE_VERIFICATION_FAILED',
          'La clave pública proporcionada no pertenece al usuario'
        )
      }

      // PASO 2: Verificación criptográfica usando decodificación según tipo de mensaje
      const wax = await createWaxFoundation()

      try {
        // Detectar si el mensaje es una transacción JSON o un mensaje simple
        let transactionData: { operations?: unknown[] } | null = null

        try {
          const parsed = JSON.parse(message) as Record<string, unknown>
          // Verificar si realmente es una transacción con operaciones
          if (
            parsed.operations &&
            Array.isArray(parsed.operations)
          ) {
            transactionData = parsed as { operations: unknown[] }
          }
        } catch {
          // No es JSON válido o no es una transacción
          transactionData = null
        }

        if (transactionData && transactionData.operations) {
          // Verificación de transacción completa
          return await this.verifyTransactionSignature(
            wax,
            transactionData as { operations: unknown[] },
            hiveSignature,
            hivePublicKey,
            postingKeyAuths,
            username
          )
        } else {
          // Mensaje simple - verificación criptográfica real
          return this.verifyBasicMessage(
            wax,
            message,
            hiveSignature,
            hivePublicKey,
            postingKeyAuths,
            username
          )
        }
      } catch (signatureError) {
        return this.createErrorResult(
          'SIGNATURE_VERIFICATION_FAILED',
          'La firma no pudo ser verificada'
        )
      }
    } catch (error) {
      return {
        valid: false,
        error: `Error en verificación: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      }
    }
  }

  /**
   * Verifica firma de transacción completa usando WAX
   * @param wax - WAX foundation instance for cryptographic operations
   * @param transactionData - Raw transaction data from JSON (will be built into ITransaction)
   */
  private async verifyTransactionSignature(
    wax: IWaxBaseInterface,
    transactionData: { operations: unknown[] },
    hiveSignature: HiveSignature,
    hivePublicKey: HivePublicKey,
    postingKeyAuths: readonly [string, number][],
    username: string
  ): Promise<HiveSignatureVerificationResult> {
    try {
      // Crear transacción desde JSON
      const reconstructedTx = wax.createTransactionFromJson(transactionData)

      // Asegurar que la transacción tiene la firma
      const txAny = reconstructedTx as any
      if (!txAny.transaction) {
        txAny.transaction = transactionData
      }
      if (!txAny.transaction.signatures) {
        txAny.transaction.signatures = []
      }

      if (!txAny.transaction.signatures.includes(hiveSignature)) {
        txAny.transaction.signatures.push(hiveSignature)
      }

      // Obtener claves decodificadas
      const signatureKeys = reconstructedTx.signatureKeys

      // Encontrar clave coincidente
      let matchedKey: HivePublicKey | undefined
      let serializationType: HiveSerializationType = 'Unknown'

      const decodedHf26Key = signatureKeys?.[0]

      if (
        decodedHf26Key &&
        postingKeyAuths.find(([key]) => key === decodedHf26Key)
      ) {
        matchedKey = createHivePublicKey(decodedHf26Key)
        serializationType = 'HF26'
      }

      if (!matchedKey) {
        return this.createErrorResult(
          'SIGNATURE_VERIFICATION_FAILED',
          'La firma no es válida para esta transacción'
        )
      }

      // Verificar anti-inyección
      if (matchedKey !== hivePublicKey) {
        return this.createErrorResult(
          'SIGNATURE_VERIFICATION_FAILED',
          'La clave pública no coincide con la clave que generó la firma'
        )
      }

      return {
        valid: true,
        matchedKey,
        serializationType,
        details: {
          decodedKeys: [matchedKey],
          verifyAuthorityResult: true,
        },
      }
    } catch (txError) {
      return this.createErrorResult(
        'SIGNATURE_VERIFICATION_FAILED',
        'La firma de transacción no pudo ser verificada'
      )
    }
  }

  /**
   * Verifica mensaje simple con verificación criptográfica real.
   * Recupera la public key desde la firma y verifica que pertenece al usuario.
   */
  private verifyBasicMessage(
    wax: IWaxBaseInterface,
    message: string,
    signature: HiveSignature,
    hivePublicKey: HivePublicKey,
    postingKeyAuths: readonly [string, number][],
    username: string
  ): HiveSignatureVerificationResult {
    try {
      // Calcular SHA-256 del mensaje (mismo proceso que Keychain usa internamente)
      const sigDigest = createHash('sha256').update(message).digest('hex')

      // Recuperar la public key que generó la firma
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

      // Verificar anti-inyección: la key enviada por el cliente debe coincidir
      if (recoveredKey !== hivePublicKey) {
        return this.createErrorResult(
          'PUBLIC_KEY_MISMATCH',
          'La clave pública enviada no coincide con la clave que generó la firma'
        )
      }

      return {
        valid: true,
        matchedKey: hivePublicKey,
        serializationType: 'Unknown' as HiveSerializationType,
        details: {
          sigDigest,
          decodedKeys: [createHivePublicKey(recoveredKey)],
          verifyAuthorityResult: true,
        },
      }
    } catch (error) {
      return this.createErrorResult(
        'SIGNATURE_VERIFICATION_FAILED',
        `Error en verificación criptográfica: ${error instanceof Error ? error.message : 'Error desconocido'}`
      )
    }
  }

  /**
   * Verifica que la cuenta existe en Hive blockchain usando find_accounts
   */
  private async verifyHiveAccount(
    username: HiveUsername,
    chain: IHiveChainInterface
  ): Promise<HiveAccountVerificationResult> {
    try {
      const accountData = await chain.api.database_api.find_accounts({
        accounts: [username],
        delayed_votes_active: true,
      })

      if (accountData.accounts.length === 0) {
        return {
          valid: false,
          error: `Cuenta ${username} no encontrada en Hive blockchain`,
        }
      }

      const account = accountData.accounts[0] as unknown as HiveAccountData

      return {
        valid: true,
        accountData: account,
      }
    } catch (error) {
      return {
        valid: false,
        error: `Error al verificar cuenta: ${error instanceof Error ? error.message : 'Error desconocido'}`,
      }
    }
  }
}

// Instancia singleton para uso directo
export const hiveSignatureVerifier = new HiveSignatureVerifier()

// Función principal para verificación de firmas Keychain
export async function quickVerifySignature(
  params: HiveSignatureVerificationRequest
): Promise<HiveSignatureVerificationResult> {
  return hiveSignatureVerifier.verifyMessageSignature(params)
}
