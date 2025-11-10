import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { db } from '@/lib/database'
import { HTTP_STATUS } from '@/consts/constants'
// Logger removed

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

    // Primero intentar encontrar como Builder
    const builderResult = await db.execute({
      sql: 'SELECT id, hive_username FROM Builders WHERE hive_username = ? AND is_active = TRUE',
      args: [username],
    })

    // Si no es Builder, intentar como Admin
    const adminResult = await db.execute({
      sql: 'SELECT id, username FROM Admins WHERE username = ? AND is_active = TRUE',
      args: [username],
    })

    let historyQuery: string
    let queryArgs: string[]

    if (builderResult.rows.length > 0) {
      // Es un Builder - obtener tickets creados por este builder
      const builderId = builderResult.rows[0].id as number
      historyQuery = `
        SELECT
          t.id, t.code, t.type, t.description,
          t.original_credits, t.credits, t.created_at,
          ta.action, ta.timestamp,
          b.hive_username as created_by_username
        FROM Tickets t
        LEFT JOIN TicketAudit ta ON t.code = ta.ticket
        LEFT JOIN Builders b ON t.created_by_builder = b.id
        WHERE t.created_by_builder = ?
        ORDER BY COALESCE(ta.timestamp, t.created_at) DESC
      `
      queryArgs = [builderId.toString()]
    } else if (adminResult.rows.length > 0) {
      // Es un Admin - obtener tickets creados por este admin
      const adminId = adminResult.rows[0].id as number
      historyQuery = `
        SELECT
          t.id, t.code, t.type, t.description,
          t.original_credits, t.credits, t.created_at,
          ta.action, ta.timestamp,
          a.username as created_by_username
        FROM Tickets t
        LEFT JOIN TicketAudit ta ON t.code = ta.ticket
        LEFT JOIN Admins a ON t.created_by_admin = a.id
        WHERE t.created_by_admin = ?
        ORDER BY COALESCE(ta.timestamp, t.created_at) DESC
      `
      queryArgs = [adminId.toString()]
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Usuario no encontrado' }),
        {
          status: HTTP_STATUS.NOT_FOUND,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Obtener historial completo de créditos
    const historyResult = await db.execute({
      sql: historyQuery,
      args: queryArgs,
    })

    const creditHistory = historyResult.rows as any[]

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
        new Date(item.timestamp || item.created_at).toLocaleString('es-ES'),
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
