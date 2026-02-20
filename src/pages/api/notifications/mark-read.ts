/**
 * API Endpoint: Mark notification as read
 * POST /api/notifications/mark-read
 * Body: { notificationId: number }
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { getSession } from 'auth-astro/server'
import { markAsRead } from '@/lib/notification-service'
import { UsersRepository } from '@/lib/repositories/users-repository'

export const POST: APIRoute = async ({ request }) => {
	try {
		// Get session
		const session = await getSession(request)
		const user = session?.user

		if (!user?.username) {
			return new Response(
				JSON.stringify({ success: false, error: 'No autenticado' }),
				{ status: 401, headers: { 'Content-Type': 'application/json' } }
			)
		}

		// Get user from database to get ID
		const usersRepo = new UsersRepository()
		const dbUser = await usersRepo.getByUsername(user.username)
		if (!dbUser) {
			return new Response(
				JSON.stringify({ success: false, error: 'Usuario no encontrado' }),
				{ status: 404, headers: { 'Content-Type': 'application/json' } }
			)
		}

		// Parse request body
		const body = await request.json()
		const { notificationId } = body

		if (!notificationId || typeof notificationId !== 'number') {
			return new Response(
				JSON.stringify({ success: false, error: 'ID de notificación inválido' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			)
		}

		// Mark notification as read
		const success = await markAsRead(notificationId, dbUser.id)

		if (!success) {
			return new Response(
				JSON.stringify({ success: false, error: 'No se pudo marcar la notificación' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			)
		}

		return new Response(
			JSON.stringify({ success: true }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		)
	} catch (error) {
		logger.error('Error marking notification as read:', error)
		return new Response(
			JSON.stringify({ success: false, error: 'Error interno del servidor' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		)
	}
}
