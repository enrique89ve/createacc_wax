import { db } from '@/lib/database'
import { parseTicketRow } from '@/types/database'

export interface UpdateTicketUsesResultSuccess {
  readonly ok: true
  readonly ticketId: number
  readonly code: string
  readonly oldUses: number
  readonly newUses: number
}

export interface UpdateTicketUsesResultError {
  readonly ok: false
  readonly error: string
}

export type UpdateTicketUsesResult =
  | UpdateTicketUsesResultSuccess
  | UpdateTicketUsesResultError

export async function updateTicketUses(options: {
  readonly code: string
  readonly delta: number // puede ser negativo
  readonly performedBy?: number
}): Promise<UpdateTicketUsesResult> {
  try {
    const { code, delta, performedBy } = options
    if (typeof code !== 'string' || !code.trim()) {
      return { ok: false, error: 'Código inválido' }
    }
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) {
      return { ok: false, error: 'Delta inválido' }
    }

    // Intentar update con chequeo de no negativo
    const result = await db.execute({
      sql: `UPDATE Tickets
			      SET remaining_uses = remaining_uses + ?,
			          total_uses = total_uses + ?,
			          updated_at = CURRENT_TIMESTAMP
			      WHERE code = ? AND (remaining_uses + ?) >= 0
			        AND (total_uses + ?) >= (remaining_uses + ?)
			      RETURNING *`,
      args: [delta, delta, code.trim().toUpperCase(), delta, delta, delta],
    })

    if (result.rows.length === 0) {
      return {
        ok: false,
        error: 'Ticket no encontrado o usos insuficientes',
      }
    }

    const ticket = parseTicketRow(result.rows[0])
    if (!ticket) {
      return { ok: false, error: 'Error parseando ticket actualizado' }
    }

    const newUses = ticket.remaining_uses
    const oldUses = newUses - delta

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
      oldUses,
      newUses,
    }
  } catch (error) {
    return { ok: false, error: 'Error interno' }
  }
}
