import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { db } from '@/lib/database'
import { HTTP_STATUS } from '@/consts/constants'
import { BRAND } from '@/consts/branding'
import { UserRole } from '@/lib/roles'
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

    // Verify that there are pending credits to claim
    const pendingCreditsResult = await db.execute({
      sql: `SELECT id, pending_amount FROM Credits
            WHERE builder_id = ? AND pending_amount > 0
            LIMIT 1`,
      args: [builderId],
    })

    if (pendingCreditsResult.rows.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'No hay créditos pendientes para reclamar',
        }),
        {
          status: HTTP_STATUS.NOT_FOUND,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const pendingCredit = pendingCreditsResult.rows[0] as unknown as CreditPendingRow
    const creditsToGrant = Number(pendingCredit.pending_amount)
    const creditId = pendingCredit.id

    // Generate unique code for this claim
    const claimCode = `credit_${creditId}_${Date.now()}`

    // Generate hash and store in cache
    const hashData = claimHashCache.generateHash(
      session.user.username,
      claimCode,
      creditsToGrant
    )

    // Create the custom JSON structure for Keychain
    const customJson = {
      id: 'claim_credits',
      json: {
        app: BRAND.CLAIM_APP_ID,
        hash: hashData.hash,
        username: session.user.username,
        timestamp: hashData.createdAt,
        action: 'claim_credits',
      },
    }

    return new Response(
      JSON.stringify({
        success: true,
        hash: hashData.hash,
        customJson: customJson,
        claimCode: claimCode,
        // creditId removed for security - do not expose internal IDs
        creditsAvailable: creditsToGrant,
        expiresAt: new Date(hashData.expiresAt).toISOString(),
      }),
      {
        status: HTTP_STATUS.OK,
        headers: { 'Content-Type': 'application/json' },
      }
    )
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
