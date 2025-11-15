import type { APIRoute } from 'astro'
import { validateTicketInDB } from '@/utils/db-ticket-validator'

// Rate limiting simple - solo para seguridad básica  
const lastRequests = new Map<string, number>()
const RATE_LIMIT_MS = 1000 // 1 segundo entre requests del mismo IP

export const POST: APIRoute = async ({ request, clientAddress }) => {
	try {
		// Rate limiting básico por IP
		const clientIP = clientAddress || 'unknown'
		const now = Date.now()
		const lastRequest = lastRequests.get(clientIP) || 0
		
		if (now - lastRequest < RATE_LIMIT_MS) {
			return new Response(
				JSON.stringify({
					error: 'Too many requests. Please wait.'
				}),
				{ 
					status: 429, 
					headers: { 'Content-Type': 'application/json' } 
				}
			)
		}
		
		lastRequests.set(clientIP, now)
		
		const data = await request.json()
		const { ticket } = data

		// Validar que se proporcione el ticket
		if (!ticket) {
			return new Response(
				JSON.stringify({
					error: 'Ticket es requerido'
				}),
				{ 
					status: 400, 
					headers: { 'Content-Type': 'application/json' } 
				}
			)
		}

		// Validar ticket en la base de datos
		const validation = await validateTicketInDB(ticket)

		if (!validation.isValid) {
			return new Response(
				JSON.stringify({
					valid: false,
					error: validation.error
				}),
				{ 
					status: 200, 
					headers: { 'Content-Type': 'application/json' } 
				}
			)
		}

		// Ticket válido
		return new Response(
			JSON.stringify({
				valid: true,
				ticket: {
					code: validation.ticket?.code,
					type: validation.ticket?.type,
					description: validation.ticket?.description
				}
			}),
			{ 
				status: 200, 
				headers: { 'Content-Type': 'application/json' } 
			}
		)
	} catch (error) {
		return new Response(
			JSON.stringify({
				valid: false,
				error: 'Error interno del servidor'
			}),
			{ 
				status: 500, 
				headers: { 'Content-Type': 'application/json' } 
			}
		)
	}
}