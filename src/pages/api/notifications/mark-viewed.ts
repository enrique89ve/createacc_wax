/**
 * API Endpoint: Mark notifications as viewed
 * POST /api/notifications/mark-viewed
 * Body: Empty (uses userId from session)
 */

import type { APIRoute } from 'astro'
import { logger } from '@/lib/logger'
import { getSession } from 'auth-astro/server'
import { markAsViewed } from '@/lib/notification-service'
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

		// Mark all un-viewed notifications as viewed
		const success = await markAsViewed(dbUser.id)

		if (!success) {
			return new Response(
				JSON.stringify({ success: false, error: 'No se pudieron marcar las notificaciones' }),
				{ status: 400, headers: { 'Content-Type': 'application/json' } }
			)
		}

		return new Response(
			JSON.stringify({ success: true }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		)
	} catch (error) {
		logger.error('Error marking notifications as viewed:', error)
		return new Response(
			JSON.stringify({ success: false, error: 'Error interno del servidor' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		)
	}
}
