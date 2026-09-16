/**
 * API Endpoint: Mark all notifications as read
 * POST /api/notifications/mark-all-read
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { markAllAsRead } from '@/lib/notification-service'
import { withBuilderApiSession } from '@/lib/session-helpers'

export const POST: APIRoute = async context => {
  return withBuilderApiSession(context, async session => {
    try {
      const success = await markAllAsRead(session.username)

      if (!success) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No se pudieron marcar las notificaciones',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      logger.error('Error marking all notifications as read:', error)
      return new Response(
        JSON.stringify({ success: false, error: 'Error interno del servidor' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  })
}
