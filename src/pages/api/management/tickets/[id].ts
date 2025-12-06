import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import { db } from '@/lib/database'
import { parseTicketRow } from '@/types/database'
import type { DatabaseTicketRow } from '@/types/database'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { creditsService } from '@/lib/credits-service'
import { jsonResponse } from '@/utils/api-response'
import { USER_ROLES } from '@/consts/constants'
import { API_MESSAGES } from '@/consts/api-messages'
import { requireValidOrigin } from '@/utils/csrf-protection'

// Types
interface CreatorInfo {
  readonly userId: number
  readonly username: string
  readonly role: 'builder' | 'admin'
}

interface TicketDeletionResult {
  readonly success: true
  readonly message: string
  readonly credits_info: {
    readonly credits_returned: number
    readonly new_credits: number
  }
}

// Helper: Obtener información del creador del ticket
const getTicketCreator = async (
  ticket: DatabaseTicketRow
): Promise<CreatorInfo | null> => {
  if (!ticket.created_by) {
    return null
  }

  const result = await db.execute({
    sql: 'SELECT id, username, role FROM Users WHERE id = ?',
    args: [ticket.created_by],
  })

  if (result.rows.length === 0) return null

  const user = result.rows[0]
  return {
    userId: user.id as number,
    username: user.username as string,
    role: user.role as 'admin' | 'builder',
  }
}

// Helper: Verificar permisos de eliminaci�n
const canDeleteTicket = (
  sessionRole: string,
  sessionUserId: number,
  creatorUserId: number
): boolean => {
  return sessionRole === USER_ROLES.ADMIN || sessionUserId === creatorUserId
}

// Helper: Crear auditor�a de eliminaci�n
const createDeletionAudit = async (
  ticketCode: string,
  sessionUserId: number
): Promise<void> => {
  await db.execute({
    sql: `INSERT INTO TicketAudit (ticket, action, performed_by)
			VALUES (?, 'delete', ?)`,
    args: [ticketCode, sessionUserId],
  })
}

// Helper: Eliminar auditor�as previas del ticket
const cleanupTicketAudit = async (ticketCode: string): Promise<void> => {
  await db.execute({
    sql: 'DELETE FROM TicketAudit WHERE ticket = ? AND action != ?',
    args: [ticketCode, 'delete'],
  })
}

// DELETE: Eliminar ticket
export const DELETE: APIRoute = async context => {
  // CSRF Protection
  const csrfCheck = requireValidOrigin(context.request)
  if (csrfCheck) return csrfCheck

  return withAdminApiSession(context, async session => {
    try {
      const ticketId = context.params.id

      // Validaci�n: ID de ticket
      if (!ticketId || isNaN(Number(ticketId))) {
        return jsonResponse({ error: API_MESSAGES.ERRORS.TICKET_ID_INVALID }, 400)
      }

      // Obtener ticket
      const ticketResult = await db.execute({
        sql: 'SELECT id, code, description, original_credits, credits, is_active, has_been_used, created_by, created_at, updated_at FROM Tickets WHERE id = ?',
        args: [Number(ticketId)],
      })

      if (ticketResult.rows.length === 0) {
        return jsonResponse({ error: API_MESSAGES.ERRORS.TICKET_NOT_FOUND }, 404)
      }

      const ticket = parseTicketRow(ticketResult.rows[0])
      if (!ticket) {
        return jsonResponse({ error: API_MESSAGES.ERRORS.TICKET_INVALID }, 500)
      }

      // Validaci�n: Ticket ya usado
      if (ticket.has_been_used) {
        return jsonResponse(
          { error: API_MESSAGES.ERRORS.TICKET_CANNOT_DELETE_USED },
          400
        )
      }

      // Obtener informaci�n del creador
      const creator = await getTicketCreator(ticket)
      if (!creator) {
        return jsonResponse(
          { error: API_MESSAGES.ERRORS.CANNOT_DETERMINE_CREATOR },
          500
        )
      }

      // Validaci�n: Permisos
      if (!canDeleteTicket(session.role, session.userId, creator.userId)) {
        return jsonResponse(
          { error: API_MESSAGES.ERRORS.UNAUTHORIZED_DELETE_TICKET },
          403
        )
      }

      // Devolver créditos al creador directamente como 'claimed' (disponibles de inmediato)
      try {
        const creatorCredits = await creditBalanceTracker.getBalance(
          creator.username
        )
        if (creatorCredits) {
          await creditsService.refundCreditsFromTicket(
            creatorCredits.builder_id,
            ticket.original_credits,
            ticket.code
          )
        }
      } catch (error) {
        return jsonResponse(
          {
            error: API_MESSAGES.ERRORS.CREDITS_REFUND_ERROR,
            details: error instanceof Error ? error.message : 'Unknown error',
          },
          500
        )
      }

      // Crear auditoría de eliminación
      await createDeletionAudit(ticket.code, session.userId)

      // Limpiar auditor�as previas
      await cleanupTicketAudit(ticket.code)

      // Eliminar ticket
      await db.execute({
        sql: 'DELETE FROM Tickets WHERE id = ?',
        args: [ticket.id],
      })

      // Obtener balance final
      const finalCredits = await creditBalanceTracker.getBalance(
        creator.username
      )

      const result: TicketDeletionResult = {
        success: true,
        message: API_MESSAGES.SUCCESS.TICKET_DELETED,
        credits_info: {
          credits_returned: ticket.original_credits,
          new_credits: finalCredits?.available_amount || 0,
        },
      }

      return jsonResponse(result, 200)
    } catch (error) {
      return jsonResponse({ error: API_MESSAGES.ERRORS.INTERNAL_ERROR }, 500)
    }
  })
}
