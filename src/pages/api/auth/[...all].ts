import type { APIRoute } from 'astro'
import { auth } from '@/lib/auth'

export const ALL: APIRoute = async (context) => {
	const forwarded = context.clientAddress
	if (forwarded) {
		context.request.headers.set('x-forwarded-for', forwarded)
	}
	return auth.handler(context.request)
}
