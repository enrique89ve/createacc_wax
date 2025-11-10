import { db } from '@/lib/database'
import { parseTicketRow } from '@/types/database'
import type { DatabaseTicketRow } from '@/types/database'

export interface UpdateTicketCreditsResultSuccess {
  readonly ok: true
  readonly ticketId: number
  readonly code: string
  readonly oldCredits: number
  readonly newCredits: number
}

export interface UpdateTicketCreditsResultError {
  readonly ok: false
  readonly error: string
}

export type UpdateTicketCreditsResult =
  | UpdateTicketCreditsResultSuccess
  | UpdateTicketCreditsResultError

function isPositiveInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n)
}

export async function updateTicketCredits(options: {
  readonly code: string
  readonly delta: number // puede ser negativo
  readonly performedBy?: number
  readonly reason?: string
}): Promise<UpdateTicketCreditsResult> {
  try {
    const { code, delta, performedBy, reason } = options
    if (typeof code !== 'string' || !code.trim()) {
      return { ok: false, error: 'Código inválido' }
    }
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) {
      return { ok: false, error: 'Delta inválido' }
    }

    // Intentar update con chequeo de no negativo
    const result = await db.execute({
      sql: `UPDATE Tickets
			      SET credits = credits + ?,
			          updated_at = CURRENT_TIMESTAMP
			      WHERE code = ? AND (credits + ?) >= 0
			      RETURNING *`,
      args: [delta, code.trim().toUpperCase(), delta],
    })

    if (result.rows.length === 0) {
      return {
        ok: false,
        error: 'Ticket no encontrado o créditos insuficientes',
      }
    }

    const ticket = parseTicketRow(result.rows[0])
    if (!ticket) {
      return { ok: false, error: 'Error parseando ticket actualizado' }
    }

    const newCredits = ticket.credits
    const oldCredits = newCredits - delta

    await db.execute({
      sql: `INSERT INTO TicketAudit (ticket, action, performed_by)
			      VALUES (?, 'update', ?)`,
      args: [
        ticket.code,
        performedBy ?? 1, // Default admin user if not specified
      ],
    })

    return {
      ok: true,
      ticketId: ticket.id,
      code: ticket.code,
      oldCredits,
      newCredits,
    }
  } catch (error) {
    return { ok: false, error: 'Error interno' }
  }
}
