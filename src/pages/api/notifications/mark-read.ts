/**
 * API Endpoint: Mark notification as read
 * POST /api/notifications/mark-read
 * Body: { notificationId: number }
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { markAsRead } from '@/lib/notification-service'
import { withBuilderApiSession } from '@/lib/session-helpers'

export const POST: APIRoute = async context => {
  return withBuilderApiSession(context, async session => {
    try {
      const body = await context.request.json()
      const { notificationId } = body as { notificationId?: unknown }

      if (
        typeof notificationId !== 'number' ||
        !Number.isInteger(notificationId) ||
        notificationId <= 0
      ) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'ID de notificación inválido',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      const success = await markAsRead(notificationId, session.username)

      if (!success) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No se pudo marcar la notificación',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      logger.error('Error marking notification as read:', error)
      return new Response(
        JSON.stringify({ success: false, error: 'Error interno del servidor' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  })
}
