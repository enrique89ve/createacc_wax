/**
 * API Endpoint: Mark all notifications as read
 * POST /api/notifications/mark-all-read
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { markAllAsRead } from '@/lib/notification-service'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { HTTP_STATUS } from '@/consts/constants'
import { apiError, apiSuccess } from '@/utils/errorResponse'

export const POST: APIRoute = async context => {
  return withBuilderApiSession(context, async session => {
    try {
      const success = await markAllAsRead(session.username)

      if (!success) {
        return apiError(
          'No se pudieron marcar las notificaciones',
          HTTP_STATUS.BAD_REQUEST
        )
      }

      return apiSuccess({})
    } catch (error) {
      logger.error('Error marking all notifications as read:', error)
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
