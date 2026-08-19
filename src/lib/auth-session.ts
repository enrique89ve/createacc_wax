import { auth } from '@/lib/auth'
import { getCookies } from 'better-auth/cookies'
import { UserRole, isValidRole } from '@/lib/roles'
import type { AuthMethod } from '@/types/auth'
import { hiveAuthEmail } from '@/lib/auth-user'
import { logger } from '@/lib/logger'

export interface AppAuthSession {
	readonly userId: string
	readonly username: string
	readonly role: UserRole
	readonly authMethod: AuthMethod
	readonly isActive: boolean
	readonly loginTime: number
}

export async function getAppAuthSession(
	headers: Headers
): Promise<AppAuthSession | null> {
	try {
		const result = await auth.api.getSession({ headers })
		if (!result?.user) return null

		const user = result.user as typeof result.user & {
			username?: string
			role?: string
			authMethod?: string
			isActive?: boolean
		}

		const username = user.username || user.name
		if (!username) return null

		const role = user.role
		if (!isValidRole(role)) return null

		const authMethod: AuthMethod =
			user.authMethod === 'password' ? 'password' : 'keychain'

		return {
			userId: user.id,
			username,
			role,
			authMethod,
			isActive: user.isActive !== false,
			loginTime: new Date(result.session.createdAt).getTime(),
		}
	} catch (error) {
		logger.warn(
			`[auth-session] getSession failed: ${error instanceof Error ? error.message : 'unknown'}`
		)
		return null
	}
}

export async function createAppAuthSession(params: {
	readonly username: string
	readonly role: UserRole
	readonly authMethod: AuthMethod
	readonly userId?: string
	readonly isActive?: boolean
}): Promise<{ token: string; userId: string } | null> {
	const ctx = await auth.$context
	const email = hiveAuthEmail(params.username)
	const existing = await ctx.internalAdapter.findUserByEmail(email)

	const profile = {
		name: params.username,
		email,
		emailVerified: true,
		username: params.username,
		role: params.role,
		authMethod: params.authMethod,
		isActive: params.isActive ?? true,
	}

	const user = existing
		? await ctx.internalAdapter.updateUser(existing.user.id, profile)
		: await ctx.internalAdapter.createUser(profile, {
				method:
					params.authMethod === 'password'
						? 'email-password'
						: 'hive-keychain',
			})

	if (!user) return null

	const session = await ctx.internalAdapter.createSession(user.id)
	if (!session) return null

	return { token: session.token, userId: user.id }
}

export function appendSessionCookie(headers: Headers, token: string): void {
	const cookies = getCookies(auth.options)
	const sessionCookie = cookies.sessionToken
	const attributes = sessionCookie.attributes
	const parts = [
		`${sessionCookie.name}=${token}`,
		`Path=${attributes.path}`,
		`HttpOnly`,
		`SameSite=${String(attributes.sameSite)}`,
	]

	if (typeof attributes.maxAge === 'number') {
		parts.push(`Max-Age=${attributes.maxAge}`)
	}
	if (attributes.secure) {
		parts.push('Secure')
	}

	headers.append('Set-Cookie', parts.join('; '))
}

export async function signOutAuth(request: Request): Promise<void> {
	await auth.api.signOut({
		headers: request.headers,
	})
}
