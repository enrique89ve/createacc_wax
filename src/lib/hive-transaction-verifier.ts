/**
 * 🔍 HIVE TRANSACTION VERIFIER
 *
 * Utilidades para verificar transacciones custom JSON en la blockchain de Hive
 */

import { createHiveChain, type TWaxRestExtended } from '@hiveio/wax'

interface ITransactionByIdRequest {
  transactionId: string
}

// Estructura real de la respuesta de Wax
interface IHiveTransaction {
  transaction_id: string
  block_num: number
  transaction_num: number
  timestamp: string
  transaction_json: {
    expiration: string
    extensions: unknown[]
    operations: Array<{
      type: string
      value: {
        id: string
        json: string
        required_auths: string[]
        required_posting_auths: string[]
      }
    }>
    signatures: string[]
    ref_block_num: number
    ref_block_prefix: number
  }
}

// Crear la estructura API extendida
type TExtendedRestApi = {
  'hafah-api': {
    transactions: {
      byId: {
        params: ITransactionByIdRequest
        result: IHiveTransaction
      }
    }
  }
}

export interface ClaimVerificationResult {
  valid: boolean
  error?: string
  transaction?: IHiveTransaction
  customJson?: {
    app: string
    hash: string
    username: string
    timestamp: number
    action: string
  }
}

/**
 * Verifica una transacción custom JSON para operaciones de claim
 */
export async function verifyClaimTransaction(
  transactionId: string,
  expectedHash: string,
  expectedUsername: string
): Promise<ClaimVerificationResult> {
  try {
    // Crear instancia de la cadena Hive
    const chain = await createHiveChain()

    // Extender la API REST para incluir hafah-api
    const extended: TWaxRestExtended<TExtendedRestApi> = chain.extendRest({
      'hafah-api': {
        transactions: {
          byId: {
            urlPath: '{transactionId}',
          },
        },
      },
    })

    // Obtener la transacción por ID
    const transaction = await extended.restApi['hafah-api'].transactions.byId({
      transactionId,
    })

    if (!transaction) {
      return {
        valid: false,
        error: 'Transacción no encontrada en la blockchain',
      }
    }

    // Buscar operación custom_json con id 'claim_credits'
    const customJsonOp = transaction.transaction_json.operations?.find(
      op =>
        op.type === 'custom_json_operation' && op.value.id === 'claim_credits'
    )
    if (!customJsonOp) {
      return {
        valid: false,
        error: 'No se encontró operación claim_credits en la transacción',
      }
    }

    // Acceder a los datos de la operación
    const opData = customJsonOp.value

    // Verificar que el usuario tiene autorización posting
    const requiredPostingAuths = opData.required_posting_auths || []
    if (!requiredPostingAuths.includes(expectedUsername)) {
      return {
        valid: false,
        error: 'El usuario no tiene autorización posting en la transacción',
        transaction,
      }
    }

    // Parsear el JSON de la operación
    let customJsonData
    try {
      customJsonData = JSON.parse(opData.json)
    } catch (parseError) {
      return {
        valid: false,
        error: 'JSON de la operación inválido',
      }
    }

    // Verificar estructura del custom JSON
    if (!customJsonData.app || customJsonData.app !== 'holahiveCreateAcc') {
      return {
        valid: false,
        error: 'App identificador incorrecto en custom JSON',
      }
    }

    if (!customJsonData.hash || customJsonData.hash !== expectedHash) {
      return {
        valid: false,
        error: 'Hash de validación no coincide',
      }
    }

    if (
      !customJsonData.username ||
      customJsonData.username !== expectedUsername
    ) {
      return {
        valid: false,
        error: 'Username en custom JSON no coincide',
      }
    }

    if (customJsonData.action !== 'claim_credits') {
      return {
        valid: false,
        error: 'Acción en custom JSON incorrecta',
      }
    }

    // Verificar que la transacción no sea demasiado antigua (máximo 30 minutos)
    const transactionTime = new Date(transaction.timestamp).getTime()
    const now = Date.now()
    const maxAge = 30 * 60 * 1000 // 30 minutos

    if (now - transactionTime > maxAge) {
      return {
        valid: false,
        error: 'La transacción es demasiado antigua para ser válida',
      }
    }

    return {
      valid: true,
      transaction,
      customJson: customJsonData,
    }
  } catch (error) {
    return {
      valid: false,
      error: `Error verificando transacción: ${error instanceof Error ? error.message : 'Error desconocido'}`,
    }
  }
}

/**
 * Limpia hashes expirados de la base de datos
 */
export async function cleanupExpiredHashes(): Promise<void> {
  try {
    const { db } = await import('./database')

    await db.execute({
      sql: `DELETE FROM TempClaimHashes
			      WHERE expires_at < datetime('now') AND used = FALSE`,
      args: [],
    })
  } catch (error) {
    // Silently handle cleanup errors
  }
}
