/**
 * API: Verificar disponibilidad de código de ticket
 *
 * Endpoint para builders que valida si un código de ticket está disponible
 * antes de crear el ticket. Solo verifica disponibilidad, no valida formato.
 *
 * GET /api/tickets/check-code?code=ABC123
 */

import type { APIRoute } from 'astro'
import { getSession } from 'auth-astro/server'
import { ticketsRepository } from '@/lib/repositories/tickets-repository'
import { HTTP_STATUS } from '@/consts/constants'

export const GET: APIRoute = async ({ request, url }) => {
	try {
		const session = await getSession(request)

		// Solo usuarios autenticados (builders y admins)
		if (!session?.user) {
			return new Response(
				JSON.stringify({
					available: false,
					error: 'No autorizado',
				}),
				{
					status: HTTP_STATUS.UNAUTHORIZED,
					headers: { 'Content-Type': 'application/json' },
				}
			)
		}

		const code = url.searchParams.get('code')

		if (!code || !code.trim()) {
			return new Response(
				JSON.stringify({
					available: false,
					error: 'Código no especificado',
				}),
				{
					status: HTTP_STATUS.BAD_REQUEST,
					headers: { 'Content-Type': 'application/json' },
				}
			)
		}

		const ticketCode = code.trim().toUpperCase()

		// Verificar si el código ya existe
		const existingTicket = await ticketsRepository.findByCode(ticketCode)

		if (existingTicket) {
			return new Response(
				JSON.stringify({
					available: false,
					message: 'El código ya está en uso',
				}),
				{
					status: HTTP_STATUS.OK,
					headers: { 'Content-Type': 'application/json' },
				}
			)
		}

		// Código disponible
		return new Response(
			JSON.stringify({
				available: true,
				message: 'Código disponible',
			}),
			{
				status: HTTP_STATUS.OK,
				headers: { 'Content-Type': 'application/json' },
			}
		)
	} catch (error) {
		return new Response(
			JSON.stringify({
				available: false,
				error: 'Error interno del servidor',
			}),
			{
				status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
				headers: { 'Content-Type': 'application/json' },
			}
		)
	}
}
