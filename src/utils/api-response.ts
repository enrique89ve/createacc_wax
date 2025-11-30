/**
 * Helper para respuestas JSON consistentes en APIs
 */
export function jsonResponse(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}
