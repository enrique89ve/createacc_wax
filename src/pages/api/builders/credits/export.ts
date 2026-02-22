/**
 * API: Export credit history
 *
 * GET /api/builders/credits/export?format=csv
 * GET /api/builders/credits/export?format=json
 */

import type { APIRoute } from 'astro'
import { db } from '@/lib/database'
import { formatDateTime } from '@/utils/date-formatters'
import { HTTP_STATUS } from '@/consts/constants'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { assertCanPerform, unauthorizedResponse } from '@/lib/admin/permissions-management'
import { apiError } from '@/utils/errorResponse'

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

/** Safety cap to prevent unbounded memory allocation */
const EXPORT_ROW_LIMIT = 10_000

export const GET: APIRoute = async (context) => {
	return withBuilderApiSession(context, async (session) => {
		try {
			assertCanPerform(session, 'VIEW_OWN_CREDITS', 'GET /api/builders/credits/export')
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

			const historyResult = await db.execute({
				sql: `
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
					LIMIT ?
				`,
				args: [session.userId.toString(), EXPORT_ROW_LIMIT],
			})

			const creditHistory: CreditHistoryRow[] = historyResult.rows.map(
				(row: Record<string, unknown>) => ({
					id: Number(row.id),
					code: String(row.code),
					description: (row.description as string) ?? null,
					original_credits: Number(row.original_credits),
					credits: Number(row.credits),
					created_at: String(row.created_at),
					action: (row.action as string) ?? null,
					timestamp: (row.timestamp as string) ?? null,
					created_by_username: (row.created_by_username as string) ?? null,
					creator_role: (row.creator_role as string) ?? null,
				})
			)

			if (format === 'csv') {
				const csvHeaders = [
					'Date',
					'Type',
					'Code',
					'Description',
					'Original Credits',
					'Current Credits',
					'Action',
					'Status',
				]

				const csvRows = creditHistory.map(item => [
					formatDateTime(item.timestamp || item.created_at),
					item.type,
					item.code,
					item.description || '',
					item.original_credits,
					item.credits,
					item.action || 'created',
					item.credits > 0 ? 'Available' : 'Used',
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
					originalCredits: item.original_credits,
					currentCredits: item.credits,
					action: item.action || 'created',
					status: item.credits > 0 ? 'Available' : 'Used',
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
