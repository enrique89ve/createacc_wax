import type { APIRoute } from 'astro'
import { withAdminSession } from '@/lib/session-helpers'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { buildersRepository } from '@/lib/repositories/builders-repository'
import { adminsRepository } from '@/lib/repositories/admins-repository'
import { isTicketType } from '@/types/database'
import { creditsService } from '@/lib/credits-service'
// Logger removed
import { db } from '@/lib/database'
// Types
interface TicketCreateRequest {
  readonly code?: string
  readonly type?: string
  readonly description?: string
  readonly credits?: number
}

interface TicketCreationResult {
  readonly success: true
  readonly message: string
  readonly ticket: {
    readonly id: number
    readonly code: string
    readonly type: string
    readonly description: string
    readonly original_credits: number
  }
  readonly credits_info: {
    readonly credits_deducted: number
    readonly new_credits: number
  }
}

interface ErrorResponse {
  readonly error: string
  readonly details?: string
  readonly required_credits?: number
  readonly available_credits?: number
  readonly maxCredits?: number
  readonly requestedCredits?: number
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
				tickets = await ticketsRepository.getBuilderTicketsWithCreator(session.userId)
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

// Helper: Obtener datos del builder (usando repository)
const getBuilderData = async (
	builderId: number
): Promise<{ id: number; hive_username: string } | null> => {
	const builder = await buildersRepository.getById(builderId)
	return builder && builder.is_active
		? { id: builder.id, hive_username: builder.hive_username }
		: null
}

// Helper: Obtener datos del admin (usando repository)
const getAdminData = async (
	adminId: number
): Promise<{ id: number; username: string } | null> => {
	const admin = await adminsRepository.findById(adminId)
	return admin && admin.is_active
		? { id: admin.id, username: admin.username }
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
  role: string,
  userId: number
): Promise<void> => {
  const performedByBuilder = role === 'builder' ? userId : null
  const performedByAdmin = role === 'admin' ? userId : null

  await db.execute({
    sql: `INSERT INTO TicketAudit (ticket, action, performed_by_builder, performed_by_admin)
			VALUES (?, 'create', ?, ?)`,
    args: [ticketCode, performedByBuilder, performedByAdmin],
  })
}

// POST: Crear ticket
export const POST: APIRoute = async context => {
  return withAdminSession(context, async session => {
    try {
      const data = (await context.request.json()) as TicketCreateRequest

      const {
        code,
        type = 'regular',
        description = '',
        credits: creditsInput,
      } = data

      // Validación: Código de ticket
      const cleanCode = validateTicketCode(code)
      if (!cleanCode) {
        return jsonResponse({ error: 'Código de ticket inválido' }, 400)
      }

      // Validación: Tipo de ticket
      if (!isTicketType(type)) {
        return jsonResponse({ error: 'Tipo de ticket inválido' }, 400)
      }

      // Validación: Solo admin puede crear tickets tipo 'admin'
      if (type === 'admin' && session.role !== 'admin') {
        return jsonResponse(
          { error: 'No autorizado para crear tickets admin' },
          403
        )
      }

      // Normalizar créditos
      const credits = normalizeCredits(creditsInput)

      // Obtener datos del usuario según su rol
      let username: string

      if (session.role === 'admin') {
        const adminData = await getAdminData(session.userId)
        if (!adminData) {
          return jsonResponse({ error: 'Admin no encontrado' }, 404)
        }
        username = adminData.username
      } else {
        // Builder
        const builderData = await getBuilderData(session.userId)
        if (!builderData) {
          return jsonResponse({ error: 'Builder no encontrado' }, 404)
        }
        username = builderData.hive_username

        // Verificar créditos disponibles para builders
        const userCredits = await creditsService.getUserCredits(username)

        if (!userCredits || userCredits.active_credits < credits) {
          return jsonResponse(
            {
              error: `Créditos insuficientes. Necesitas ${credits} créditos, pero solo tienes ${userCredits?.active_credits || 0} disponibles.`,
              required_credits: credits,
              available_credits: userCredits?.active_credits || 0,
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
          await creditsService.consumeCredits(
            session.userId,
            credits,
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
      const createdByBuilder =
        session.role === 'builder' ? session.userId : null
      const createdByAdmin = session.role === 'admin' ? session.userId : null

      const ticketResult = await db.execute({
        sql: `INSERT INTO Tickets (code, type, description, original_credits, credits, created_by_builder, created_by_admin)
					VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        args: [
          cleanCode,
          type,
          description,
          credits,
          credits,
          createdByBuilder,
          createdByAdmin,
        ],
      })

      const ticketId = ticketResult.rows[0]?.id as number

      // Log de auditoría
      await createTicketAudit(cleanCode, session.role, session.userId)

      // Obtener balance final
      const finalUserCredits = await creditsService.getUserCredits(username)

      const result: TicketCreationResult = {
        success: true,
        message: 'Ticket creado exitosamente',
        ticket: {
          id: ticketId,
          code: cleanCode,
          type,
          description,
          original_credits: credits,
        },
        credits_info: {
          credits_deducted: credits,
          new_credits: finalUserCredits?.active_credits || 0,
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
