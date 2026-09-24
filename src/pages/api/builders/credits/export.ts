/**
 * API: Export credit history
 *
 * GET /api/builders/credits/export?format=csv
 * GET /api/builders/credits/export?format=json
 */

import type { APIRoute } from 'astro'
import { execute } from '@/lib/database'
import { formatDateTime } from '@/utils/date-formatters'
import { HTTP_STATUS } from '@/consts/constants'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { assertCanPerform, unauthorizedResponse } from '@/lib/auth/permissions'
import { apiError } from '@/utils/errorResponse'

/** Row from joined Tickets + TicketAudit + Users query */
interface CreditHistoryRow {
  readonly id: number
  readonly code: string
  readonly description: string | null
  readonly total_uses: number
  readonly remaining_uses: number
  readonly created_at: string
  readonly status: string
  readonly action: string | null
  readonly timestamp: string | null
  readonly created_by_username: string | null
  readonly type: string
}

/** Safety cap to prevent unbounded memory allocation */
const EXPORT_ROW_LIMIT = 10_000

export const GET: APIRoute = async context => {
  return withBuilderApiSession(context, async session => {
    try {
      assertCanPerform(
        session,
        'VIEW_OWN_CREDITS',
        'GET /api/builders/credits/export'
      )
    } catch {
      return unauthorizedResponse()
    }

    try {
      const format = context.url.searchParams.get('format') || 'csv'

      if (!['csv', 'json'].includes(format)) {
        return apiError(
          'Formato no soportado. Use csv o json',
          HTTP_STATUS.BAD_REQUEST
        )
      }

      const historyResult = await execute({
        sql: `
					SELECT
						t.id, t.code, t.description,
						t.total_uses, t.remaining_uses, t.created_at,
						ta.action, ta.timestamp,
						t.owner_builder_username as created_by_username,
						'Builder-funded ticket' as type,
						CASE
						  WHEN t.archived_at IS NOT NULL THEN 'Archived'
						  WHEN t.revoked_at IS NOT NULL THEN 'Revoked'
						  WHEN t.remaining_uses > 0 THEN 'Available'
						  ELSE 'Consumed'
						END as status
					FROM Tickets t
					LEFT JOIN TicketAudit ta ON ta.ticket_id = t.id
					WHERE t.funding_source = 'builder_credits'
					  AND t.owner_builder_username = ?
					ORDER BY COALESCE(ta.timestamp, t.created_at) DESC
					LIMIT ?
				`,
        args: [session.username.toString(), EXPORT_ROW_LIMIT],
      })

      const creditHistory: CreditHistoryRow[] = historyResult.rows.map(
        (row: Record<string, unknown>) => ({
          id: Number(row.id),
          code: String(row.code),
          description: (row.description as string) ?? null,
          total_uses: Number(row.total_uses),
          remaining_uses: Number(row.remaining_uses),
          created_at: String(row.created_at),
          status: String(row.status),
          action: (row.action as string) ?? null,
          timestamp: (row.timestamp as string) ?? null,
          created_by_username: (row.created_by_username as string) ?? null,
          type: String(row.type),
        })
      )

      if (format === 'csv') {
        const csvHeaders = [
          'Date',
          'Type',
          'Code',
          'Description',
          'Total Uses',
          'Remaining Uses',
          'Action',
          'Status',
        ]

        const csvRows = creditHistory.map(item => [
          formatDateTime(item.timestamp || item.created_at),
          item.type,
          item.code,
          item.description || '',
          item.total_uses,
          item.remaining_uses,
          item.action || 'created',
          item.status,
        ])

        const csvContent = [
          csvHeaders.join(','),
          ...csvRows.map(row => row.map(cell => `"${cell}"`).join(',')),
        ].join('\n')

        const timestamp = new Date().toISOString().split('T')[0]
        const filename = `creditos_${session.username}_${timestamp}.csv`

        return new Response(csvContent, {
          status: HTTP_STATUS.OK,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'no-cache',
          },
        })
      }

      // JSON format
      const jsonData = {
        exportDate: new Date().toISOString(),
        username: session.username,
        recordCount: creditHistory.length,
        data: creditHistory.map(item => ({
          date: new Date(item.timestamp || item.created_at).toISOString(),
          type: item.type,
          code: item.code,
          description: item.description,
          totalUses: item.total_uses,
          remainingUses: item.remaining_uses,
          action: item.action || 'created',
          status: item.status,
          createdBy: item.created_by_username,
        })),
      }

      const timestamp = new Date().toISOString().split('T')[0]
      const filename = `creditos_${session.username}_${timestamp}.json`

      return new Response(JSON.stringify(jsonData, null, 2), {
        status: HTTP_STATUS.OK,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache',
        },
      })
    } catch (error) {
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
