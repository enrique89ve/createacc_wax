import type { APIRoute } from 'astro'
import { withAdminApiSession } from '@/lib/session-helpers'
import { db } from '@/lib/database'
import { parseTicketRow } from '@/types/database'
import type { DatabaseTicketRow } from '@/types/database'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { creditsService } from '@/lib/credits-service'
// Logger removed

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

// Helper: Respuesta JSON
const jsonResponse = (data: unknown, status: number): Response => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
  return sessionRole === 'admin' || sessionUserId === creatorUserId
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
  return withAdminApiSession(context, async session => {
    try {
      const ticketId = context.params.id

      // Validaci�n: ID de ticket
      if (!ticketId || isNaN(Number(ticketId))) {
        return jsonResponse({ error: 'ID de ticket inv�lido' }, 400)
      }

      // Obtener ticket
      const ticketResult = await db.execute({
        sql: 'SELECT * FROM Tickets WHERE id = ?',
        args: [Number(ticketId)],
      })

      if (ticketResult.rows.length === 0) {
        return jsonResponse({ error: 'Ticket no encontrado' }, 404)
      }

      const ticket = parseTicketRow(ticketResult.rows[0])
      if (!ticket) {
        return jsonResponse({ error: 'Ticket inv�lido' }, 500)
      }

      // Validaci�n: Ticket ya usado
      if (ticket.has_been_used) {
        return jsonResponse(
          { error: 'No se puede eliminar un ticket que ha sido usado' },
          400
        )
      }

      // Obtener informaci�n del creador
      const creator = await getTicketCreator(ticket)
      if (!creator) {
        return jsonResponse(
          { error: 'No se pudo determinar el creador del ticket' },
          500
        )
      }

      // Validaci�n: Permisos
      if (!canDeleteTicket(session.role, session.userId, creator.userId)) {
        return jsonResponse(
          { error: 'No autorizado para eliminar este ticket' },
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
            error: 'Error al devolver cr�ditos',
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
        message: 'Ticket eliminado exitosamente',
        credits_info: {
          credits_returned: ticket.original_credits,
          new_credits: finalCredits?.available_amount || 0,
        },
      }

      return jsonResponse(result, 200)
    } catch (error) {
      return jsonResponse({ error: 'Error interno' }, 500)
    }
  })
}
