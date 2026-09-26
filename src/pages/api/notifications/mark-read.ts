/**
 * API Endpoint: Mark notification as read
 * POST /api/notifications/mark-read
 * Body: { notificationId: number }
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { markAsRead } from '@/lib/notification-service'
import { withBuilderApiSession } from '@/lib/session-helpers'
import { HTTP_STATUS } from '@/consts/constants'
import { apiError, apiSuccess } from '@/utils/errorResponse'
import { parseJsonObject } from '@/utils/http-input'

export const POST: APIRoute = async context => {
  return withBuilderApiSession(context, async session => {
    try {
      const body = await parseJsonObject(context.request)
      if (!body) {
        return apiError(
          'El cuerpo debe contener JSON válido',
          HTTP_STATUS.BAD_REQUEST
        )
      }
      const notificationId = body.notificationId

      if (
        typeof notificationId !== 'number' ||
        !Number.isInteger(notificationId) ||
        notificationId <= 0
      ) {
        return apiError('ID de notificación inválido', HTTP_STATUS.BAD_REQUEST)
      }

      const success = await markAsRead(notificationId, session.username)

      if (!success) {
        return apiError(
          'No se pudo marcar la notificación',
          HTTP_STATUS.BAD_REQUEST
        )
      }

      return apiSuccess({})
    } catch (error) {
      logger.error('Error marking notification as read:', error)
      return apiError(
        'Error interno del servidor',
        HTTP_STATUS.INTERNAL_SERVER_ERROR
      )
    }
  })
}
