import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { usersRepository } from '@/lib/repositories/users-repository'
import { creditBalanceTracker } from '@/lib/credit-balance-tracker'
import { creditsService } from '@/lib/credits-service'
// Logger removed
import { db } from '@/lib/database'
// Types
interface TicketCreateRequest {
  readonly code?: string
  readonly description?: string
  readonly credits?: number
}

interface TicketCreationResult {
  readonly success: true
  readonly message: string
  readonly ticket: {
    readonly id: number
    readonly code: string
    readonly description: string
    readonly original_credits: number
  }
  readonly credits_info: {
    readonly credits_deducted: number
    readonly new_credits: number
  }
}

// Helper: Crear respuesta JSON
const jsonResponse = (data: unknown, status: number): Response => {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// GET: Listar tickets
export const GET: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      let tickets

      if (session.role === 'admin') {
        // Admin puede ver todos los tickets
        tickets = await ticketsRepository.getAllWithCreators()
      } else {
        // Builder solo ve sus tickets
        tickets = await ticketsRepository.getUserTicketsWithCreator(
          session.userId
        )
      }

      return jsonResponse({ success: true, tickets }, 200)
    } catch (error) {
      return jsonResponse({ error: 'Error interno' }, 500)
    }
  })
}

// Helper: Validar código de ticket
const validateTicketCode = (code: unknown): string | null => {
  if (!code || typeof code !== 'string' || code.trim().length < 4) {
    return null
  }
  return code.trim().toUpperCase()
}

// Helper: Normalizar y validar créditos
const normalizeCredits = (creditsInput: unknown): number => {
  const creditsRaw = Number(creditsInput ?? 1)
  return Number.isFinite(creditsRaw) && creditsRaw >= 1
    ? Math.floor(creditsRaw)
    : 1
}

// Helper: Obtener datos del usuario (usando unified repository)
const getUserData = async (
  userId: number
): Promise<{ id: number; username: string } | null> => {
  const user = await usersRepository.findById(userId)
  return user && user.is_active
    ? { id: user.id, username: user.username }
    : null
}

// Helper: Verificar si el código de ticket ya existe (usando repository)
const ticketCodeExists = async (code: string): Promise<boolean> => {
  const ticket = await ticketsRepository.findByCode(code)
  return ticket !== null
}

// Helper: Crear auditoría de ticket
const createTicketAudit = async (
  ticketCode: string,
  userId: number
): Promise<void> => {
  await db.execute({
    sql: `INSERT INTO TicketAudit (ticket, action, performed_by)
			VALUES (?, 'create', ?)`,
    args: [ticketCode, userId],
  })
}

// POST: Crear ticket
export const POST: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      const data = (await context.request.json()) as TicketCreateRequest

      const { code, description = '', credits: creditsInput } = data

      // Validación: Código de ticket
      const cleanCode = validateTicketCode(code)
      if (!cleanCode) {
        return jsonResponse({ error: 'Código de ticket inválido' }, 400)
      }

      // Normalizar créditos
      const credits = normalizeCredits(creditsInput)

      // Obtener datos del usuario
      const userData = await getUserData(session.userId)
      if (!userData) {
        return jsonResponse({ error: 'Usuario no encontrado' }, 404)
      }

      const username = userData.username

      // Verificar créditos disponibles para builders
      if (session.role === 'builder') {
        const userCredits = await creditBalanceTracker.getBalance(username)

        if (!userCredits || userCredits.available_amount < credits) {
          return jsonResponse(
            {
              error: `Créditos insuficientes. Necesitas ${credits} créditos, pero solo tienes ${userCredits?.available_amount || 0} disponibles.`,
              required_credits: credits,
              available_credits: userCredits?.available_amount || 0,
            },
            403
          )
        }
      }

      // Validación: Código ya existe
      if (await ticketCodeExists(cleanCode)) {
        return jsonResponse({ error: 'El código ya existe' }, 400)
      }

      // Consumir créditos (solo para builders)
      if (session.role === 'builder') {
        try {
          await creditsService.deductCreditsForTicket(
            session.userId,
            credits,
            cleanCode
          )
        } catch (error) {
          return jsonResponse(
            {
              error: 'Error al procesar los créditos',
              details: error instanceof Error ? error.message : 'Unknown error',
            },
            500
          )
        }
      }

      // Crear ticket en base de datos (usando campos correctos del nuevo schema)
      const ticketResult = await db.execute({
        sql: `INSERT INTO Tickets (code, description, original_credits, credits, created_by)
					VALUES (?, ?, ?, ?, ?) RETURNING id`,
        args: [cleanCode, description, credits, credits, session.userId],
      })

      const ticketId = ticketResult.rows[0]?.id as number

      // Log de auditoría
      await createTicketAudit(cleanCode, session.userId)

      // Obtener balance final
      const finalUserCredits = await creditBalanceTracker.getBalance(username)

      const result: TicketCreationResult = {
        success: true,
        message: 'Ticket creado exitosamente',
        ticket: {
          id: ticketId,
          code: cleanCode,
          description,
          original_credits: credits,
        },
        credits_info: {
          credits_deducted: credits,
          new_credits: finalUserCredits?.available_amount || 0,
        },
      }

      return jsonResponse(result, 201)
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('UNIQUE constraint failed')
      ) {
        return jsonResponse({ error: 'El código ya existe' }, 400)
      }

      return jsonResponse({ error: 'Error interno' }, 500)
    }
  })
}
