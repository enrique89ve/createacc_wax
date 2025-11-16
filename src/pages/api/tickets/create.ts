import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { db } from '@/lib/database'
import { HTTP_STATUS } from '@/consts/constants'
// Logger removed

// Validación de ticket
const MIN_TICKET_LENGTH = 4
const MAX_TICKET_LENGTH = 16
const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]+$/
const ONLY_NUMBERS_REGEX = /^\d+$/

function validateTicketName(name: string): string | null {
  if (!name) return 'El nombre no puede estar vacío'
  if (name.length < MIN_TICKET_LENGTH)
    return `Mínimo ${MIN_TICKET_LENGTH} caracteres`
  if (name.length > MAX_TICKET_LENGTH)
    return `Máximo ${MAX_TICKET_LENGTH} caracteres`
  if (!ALPHANUMERIC_REGEX.test(name)) return 'Solo letras y números'
  if (ONLY_NUMBERS_REGEX.test(name)) return 'No puede ser solo números'
  return null
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request)

    if (!session?.user) {
      return new Response(
        JSON.stringify({ success: false, error: 'No autorizado' }),
        {
          status: HTTP_STATUS.UNAUTHORIZED,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const { code, credits, description } = await request.json()

    // Validar nombre del ticket
    const ticketError = validateTicketName(code)
    if (ticketError) {
      return new Response(
        JSON.stringify({ success: false, error: ticketError }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Validar créditos
    if (!credits || credits < 1 || credits > 100) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Los créditos deben estar entre 1 y 100',
        }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Obtener builder_id del usuario autenticado
    // Para builders, session.user.username siempre es el hive_username
    // session.user.id puede ser el builder.id (número) o el username (string) dependiendo del estado
    const hiveUsername = session.user.username

    if (!hiveUsername) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Error de sesión: username no disponible',
        }),
        {
          status: HTTP_STATUS.UNAUTHORIZED,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const builderResult = await db.execute({
      sql: 'SELECT id FROM Users WHERE username = ? AND role = \'builder\'',
      args: [hiveUsername],
    })

    if (builderResult.rows.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error:
            'Builder no encontrado. Asegúrate de estar registrado como builder.',
        }),
        {
          status: HTTP_STATUS.NOT_FOUND,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const builderId = Number(builderResult.rows[0].id)

    // Verificar si el código ya existe
    const existingTicket = await db.execute({
      sql: 'SELECT id FROM Tickets WHERE code = ?',
      args: [code.toUpperCase()],
    })

    if (existingTicket.rows.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Ya existe un ticket con ese código',
        }),
        {
          status: HTTP_STATUS.CONFLICT,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Verificar que el builder tenga suficientes créditos disponibles
    const creditsResult = await db.execute({
      sql: `SELECT 
						COALESCE(SUM(CASE WHEN status = 'claimed' THEN amount ELSE 0 END), 0) as claimed,
						COALESCE(SUM(CASE WHEN status = 'consumed' THEN amount ELSE 0 END), 0) as consumed
					FROM Credits
					WHERE builder_id = ?`,
      args: [builderId],
    })

    const claimed = Number(creditsResult.rows[0].claimed)
    const consumed = Math.abs(Number(creditsResult.rows[0].consumed))
    const available = claimed - consumed

    if (available < credits) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Créditos insuficientes. Disponibles: ${available}, Requeridos: ${credits}`,
        }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Crear el ticket usando campo unificado created_by
    const result = await db.execute({
      sql: `INSERT INTO Tickets (code, description, original_credits, credits, created_by)
					VALUES (?, ?, ?, ?, ?)`,
      args: [
        code.toUpperCase(),
        description || null,
        credits,
        credits,
        builderId,
      ],
    })

    // Registrar el consumo de créditos
    await db.execute({
      sql: `INSERT INTO Credits (builder_id, amount, type, status, reference)
					VALUES (?, ?, 'claimed', 'consumed', ?)`,
      args: [builderId, credits, `Ticket ${code.toUpperCase()}`],
    })

    // Auditoría
    await db.execute({
      sql: `INSERT INTO CreditAudit (builder_id, operation, amount, reason, performed_by_admin)
					VALUES (?, 'consume_credits', ?, ?, NULL)`,
      args: [builderId, -credits, `Ticket creado: ${code.toUpperCase()}`],
    })

    return new Response(
      JSON.stringify({
        success: true,
        ticketId: Number(result.lastInsertRowid),
        code: code.toUpperCase(),
        credits,
      }),
      {
        status: HTTP_STATUS.OK,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Error interno del servidor',
      }),
      {
        status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
