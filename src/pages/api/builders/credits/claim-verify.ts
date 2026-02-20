import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { db } from '@/lib/database'
import { logger } from '@/lib/logger'
import { HTTP_STATUS } from '@/consts/constants'
import { UserRole } from '@/lib/roles'
import { verifyClaimTransaction } from '@/lib/hive-transaction-verifier'
import { claimHashCache } from '@/lib/claim-hash-cache'

/** Partial row from SELECT id */
interface UserIdRow {
  readonly id: number
}

/** Partial row from SELECT id, pending_amount */
interface CreditPendingRow {
  readonly id: number
  readonly pending_amount: number
}

/** Partial row from SELECT available_amount as total */
interface BalanceTotalRow {
  readonly total: number
}

export interface ClaimVerifyRequest {
  transactionId: string
  hash: string
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request)

    if (!session?.user?.username) {
      return new Response(
        JSON.stringify({ success: false, error: 'No autorizado' }),
        {
          status: HTTP_STATUS.UNAUTHORIZED,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const { transactionId, hash }: ClaimVerifyRequest = await request.json()

    if (!transactionId || !hash) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Transaction ID y hash son requeridos',
        }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Verify and consume hash from cache
    const hashData = claimHashCache.validateAndConsume(
      hash,
      session.user.username
    )
    if (!hashData) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Hash de validación no encontrado, inválido o expirado',
        }),
        {
          status: HTTP_STATUS.NOT_FOUND,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Verify the transaction on the blockchain
    const verificationResult = await verifyClaimTransaction(
      transactionId,
      hash,
      session.user.username
    )
    if (!verificationResult.valid) {
      return new Response(
        JSON.stringify({
          success: false,
          error: verificationResult.error || 'Transacción inválida',
        }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Verify that the user is an active builder
    const builderResult = await db.execute({
      sql: `SELECT id FROM Users WHERE username = ? AND role = ? AND is_active = TRUE`,
      args: [session.user.username, UserRole.Builder],
    })

    if (builderResult.rows.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Solo los builders pueden reclamar créditos',
        }),
        {
          status: HTTP_STATUS.FORBIDDEN,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const builderId = (builderResult.rows[0] as unknown as UserIdRow).id

    // Extract creditId from the claimCode (format: credit_123_timestamp)
    const creditIdMatch = hashData.ticketCode.match(/credit_(\d+)_/)
    if (!creditIdMatch) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Código de claim inválido',
        }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const creditId = parseInt(creditIdMatch[1])
    const creditsToAdd = hashData.creditsAvailable

    // Get builder credits record
    const creditResult = await db.execute({
      sql: `SELECT id, pending_amount FROM Credits
			      WHERE id = ? AND builder_id = ?`,
      args: [creditId, builderId],
    })

    if (creditResult.rows.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Registro de créditos no encontrado',
        }),
        {
          status: HTTP_STATUS.NOT_FOUND,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const currentPending = Number((creditResult.rows[0] as unknown as CreditPendingRow).pending_amount)

    if (currentPending < creditsToAdd) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            'La cantidad de créditos pendientes ha cambiado o es insuficiente',
        }),
        {
          status: HTTP_STATUS.CONFLICT,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Process the claim using transaction
    await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

    try {
      // 1. Move credits from pending to available
      await db.execute({
        sql: `UPDATE Credits
				      SET pending_amount = pending_amount - ?,
                  available_amount = available_amount + ?,
				          updated_at = CURRENT_TIMESTAMP
				      WHERE id = ?`,
        args: [creditsToAdd, creditsToAdd, creditId],
      })

      // 2. Create audit entry
      await db.execute({
        sql: `INSERT INTO CreditAudit (
				        builder_id, operation, amount, reason, timestamp
				      ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        args: [
          builderId,
          'claim_via_blockchain',
          creditsToAdd,
          `Claimed via transaction: ${transactionId}`,
        ],
      })

      await db.execute({ sql: 'COMMIT', args: [] })

      // Get the new available credits balance
      const balanceResult = await db.execute({
        sql: `SELECT available_amount as total
				      FROM Credits
				      WHERE id = ?`,
        args: [creditId],
      })

      const newBalance = (balanceResult.rows[0] as unknown as BalanceTotalRow).total

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Créditos reclamados exitosamente',
          credits: creditsToAdd,
          // creditId removed for security - do not expose internal IDs
          transactionId: transactionId,
          newBalance,
        }),
        {
          status: HTTP_STATUS.OK,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } catch (dbError) {
      await db.execute({ sql: 'ROLLBACK', args: [] })
      throw dbError
    }
  } catch (error) {
    logger.error('Error en claim-verify:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Error interno del servidor' }),
      {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
