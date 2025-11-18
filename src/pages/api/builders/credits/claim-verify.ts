import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { db } from '@/lib/database'
import { HTTP_STATUS } from '@/consts/constants'
// Logger removed
import { verifyClaimTransaction } from '@/lib/hive-transaction-verifier'
import { claimHashCache } from '@/lib/claim-hash-cache'

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

    // Verificar y consumir hash del cache
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

    // Verificar la transacción en la blockchain
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

    // Verificar que el usuario es un builder activo
    const builderResult = await db.execute({
      sql: "SELECT id FROM Users WHERE username = ? AND role = 'builder' AND is_active = TRUE",
      args: [session.user.username],
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

    const builderId = (builderResult.rows[0] as any).id

    // Extraer creditId del claimCode (formato: credit_123_timestamp)
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

    // Verificar que el crédito aún está pendiente
    const creditResult = await db.execute({
      sql: `SELECT id, amount, builder_id, status FROM Credits
			      WHERE id = ? AND builder_id = ? AND status = 'pending'`,
      args: [creditId, builderId],
    })

    if (creditResult.rows.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Crédito no disponible o ya reclamado',
        }),
        {
          status: HTTP_STATUS.NOT_FOUND,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const creditsToAdd = hashData.creditsAvailable

    // Procesar el claim usando transacción
    await db.execute({ sql: 'BEGIN TRANSACTION', args: [] })

    try {
      // 1. Cambiar estado del crédito de 'pending' a 'claimed'
      await db.execute({
        sql: `UPDATE Credits
				      SET status = 'claimed',
				          claimed_at = CURRENT_TIMESTAMP,
				          updated_at = CURRENT_TIMESTAMP
				      WHERE id = ?`,
        args: [creditId],
      })

      // 2. Crear entrada de auditoría
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

      // Obtener el nuevo balance de créditos claimed
      const balanceResult = await db.execute({
        sql: `SELECT COALESCE(SUM(amount), 0) as total
				      FROM Credits
				      WHERE builder_id = ? AND status = 'claimed'`,
        args: [builderId],
      })

      const newBalance = (balanceResult.rows[0] as any).total

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Créditos reclamados exitosamente',
          credits: creditsToAdd,
          creditId: creditId,
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
    return new Response(
      JSON.stringify({ success: false, error: 'Error interno del servidor' }),
      {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
