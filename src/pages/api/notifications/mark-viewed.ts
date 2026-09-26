/**
 * API Endpoint: Mark notifications as viewed
 * POST /api/notifications/mark-viewed
 * Body: Empty (uses userId from session)
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { markAsViewed } from '@/lib/notification-service'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { HTTP_STATUS } from '@/consts/constants'
import { apiError, apiSuccess } from '@/utils/errorResponse'

export const POST: APIRoute = async context => {
  return withBuilderApiSession(context, async session => {
    try {
      const success = await markAsViewed(session.username)

      if (!success) {
        return apiError(
          'No se pudieron marcar las notificaciones',
          HTTP_STATUS.BAD_REQUEST
        )
      }

      return apiSuccess({})
    } catch (error) {
      logger.error('Error marking notifications as viewed:', error)
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
