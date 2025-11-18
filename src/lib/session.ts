import type { CreationSession } from '@/types/auth'
import { defineMiddleware } from 'astro:middleware'

// Derivar tipo de contexto de middleware para reutilización
export type SessionContext = Parameters<
  Parameters<typeof defineMiddleware>[0]
>[0]

export async function setCreationSession(
	context: SessionContext,
	data: CreationSession
): Promise<void> {
	const { CreationSessionManager } = await import('./session-manager')
	const manager = new CreationSessionManager(context.cookies, context.request)
	manager.set(data)
}

export async function getCreationSession(
	context: SessionContext
): Promise<CreationSession | null> {
	const { CreationSessionManager } = await import('./session-manager')
	const manager = new CreationSessionManager(context.cookies, context.request)
	return manager.get()
}
