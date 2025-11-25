/**
 * API Endpoint: Get notifications list
 * GET /api/notifications/list
 * Returns all notifications for the authenticated builder
 */

import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { getNotifications } from '@/lib/notification-service'
import { UsersRepository } from '@/lib/repositories/users-repository'

export const GET: APIRoute = async ({ request }) => {
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

		// Get notifications
		const notifications = await getNotifications(dbUser.id, 20)

		return new Response(
			JSON.stringify({ success: true, notifications }),
			{ status: 200, headers: { 'Content-Type': 'application/json' } }
		)
	} catch (error) {
		console.error('Error getting notifications:', error)
		return new Response(
			JSON.stringify({ success: false, error: 'Error interno del servidor' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		)
	}
}
