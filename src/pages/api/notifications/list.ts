/**
 * API Endpoint: Get notifications list
 * GET /api/notifications/list
 * Returns all notifications for the authenticated builder
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { getNotifications } from '@/lib/notification-service'
import { withBuilderApiSession } from '@/lib/session-helpers'

export const GET: APIRoute = async context => {
  return withBuilderApiSession(context, async session => {
    try {
      const notifications = await getNotifications(session.username, 20)

      return new Response(JSON.stringify({ success: true, notifications }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      logger.error('Error getting notifications:', error)
      return new Response(
        JSON.stringify({ success: false, error: 'Error interno del servidor' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  })
}
