import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { db } from '@/lib/database'
import { formatDateTime } from '@/utils/date-formatters'
import { HTTP_STATUS } from '@/consts/constants'
// Logger removed

/** Row from joined Tickets + TicketAudit + Users query */
interface CreditHistoryRow {
  readonly id: number
  readonly code: string
  readonly description: string | null
  readonly original_credits: number
  readonly credits: number
  readonly created_at: string
  readonly action: string | null
  readonly timestamp: string | null
  readonly created_by_username: string | null
  readonly creator_role: string | null
  readonly type?: string
}

export const GET: APIRoute = async ({ request, url }) => {
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

    const format = url.searchParams.get('format') || 'csv'

    if (!['csv', 'json'].includes(format)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Formato no soportado. Use csv o json',
        }),
        {
          status: HTTP_STATUS.BAD_REQUEST,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Determinar si el usuario es Admin o Builder
    const username = session.user.username

    // Obtener usuario de tabla unificada Users
    const userResult = await db.execute({
      sql: 'SELECT id, username, role FROM Users WHERE username = ? AND is_active = TRUE',
      args: [username],
    })

    if (userResult.rows.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Usuario no encontrado' }),
        {
          status: HTTP_STATUS.NOT_FOUND,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    const user = userResult.rows[0]
    const userId = user.id as number

    // Query unificada para obtener tickets creados por el usuario
    const historyQuery = `
      SELECT
        t.id, t.code, t.description,
        t.original_credits, t.credits, t.created_at,
        ta.action, ta.timestamp,
        u.username as created_by_username,
        u.role as creator_role
      FROM Tickets t
      LEFT JOIN TicketAudit ta ON t.code = ta.ticket
      LEFT JOIN Users u ON t.created_by = u.id
      WHERE t.created_by = ?
      ORDER BY COALESCE(ta.timestamp, t.created_at) DESC
    `
    const queryArgs = [userId.toString()]

    // Obtener historial completo de créditos
    const historyResult = await db.execute({
      sql: historyQuery,
      args: queryArgs,
    })

    const creditHistory = historyResult.rows as unknown as CreditHistoryRow[]

    if (format === 'csv') {
      // Generar CSV
      const csvHeaders = [
        'Fecha',
        'Tipo',
        'Código',
        'Descripción',
        'Créditos Originales',
        'Créditos Actuales',
        'Acción',
        'Estado',
      ]

      const csvRows = creditHistory.map(item => [
        formatDateTime(item.timestamp || item.created_at),
        item.type,
        item.code,
        item.description || '',
        item.original_credits,
        item.credits,
        item.action || 'created',
        item.credits > 0 ? 'Disponible' : 'Usado',
      ])

      const csvContent = [
        csvHeaders.join(','),
        ...csvRows.map(row => row.map(cell => `"${cell}"`).join(',')),
      ].join('\n')

      const timestamp = new Date().toISOString().split('T')[0]
      const filename = `creditos_${session.user.username}_${timestamp}.csv`

      return new Response(csvContent, {
        status: HTTP_STATUS.OK,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache',
        },
      })
    } else if (format === 'json') {
      // Generar JSON
      const jsonData = {
        exportDate: new Date().toISOString(),
        username: session.user.username,
        recordCount: creditHistory.length,
        data: creditHistory.map(item => ({
          fecha: new Date(item.timestamp || item.created_at).toISOString(),
          tipo: item.type,
          codigo: item.code,
          descripcion: item.description,
          creditosOriginales: item.original_credits,
          creditosActuales: item.credits,
          accion: item.action || 'created',
          estado: item.credits > 0 ? 'Disponible' : 'Usado',
          creadoPor: item.created_by_username,
        })),
      }

      const timestamp = new Date().toISOString().split('T')[0]
      const filename = `creditos_${session.user.username}_${timestamp}.json`

      return new Response(JSON.stringify(jsonData, null, 2), {
        status: HTTP_STATUS.OK,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache',
        },
      })
    }

    // Formato no soportado
    return new Response(
      JSON.stringify({ success: false, error: 'Formato no soportado' }),
      {
        status: HTTP_STATUS.BAD_REQUEST,
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
