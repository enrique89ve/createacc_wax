/**
 * API Endpoint: Get notifications list
 * GET /api/notifications/list
 * Returns all notifications for the authenticated builder
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { getNotifications } from '@/lib/notification-service'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { HTTP_STATUS } from '@/consts/constants'
import { apiError, apiSuccess } from '@/utils/errorResponse'

export const GET: APIRoute = async context => {
  return withBuilderApiSession(context, async session => {
    try {
      const notifications = await getNotifications(session.username, 20)

      return apiSuccess({ notifications })
    } catch (error) {
      logger.error('Error getting notifications:', error)
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
