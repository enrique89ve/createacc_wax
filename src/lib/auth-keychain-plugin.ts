import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import { type BetterAuthPlugin, z } from 'better-auth'
import { UserRole } from '@/lib/roles'
import { validateCredentials } from '@/lib/admin/auth/validators/unified-validator'
import { hiveAuthEmail } from '@/lib/auth-user'
import type { AuthMethod } from '@/types/auth'

const keychainBodySchema = z.object({
	username: z.string().min(1),
	message: z.string().min(1),
	publicKey: z.string().optional(),
	signature: z.string().optional(),
	timestamp: z.string().optional(),
})

export function hiveKeychainPlugin(): BetterAuthPlugin {
	return {
		id: 'hive-keychain',
		endpoints: {
			verifyKeychain: createAuthEndpoint(
				'/keychain/verify',
				{
					method: 'POST',
					body: keychainBodySchema,
				},
				async (ctx) => {
					const { username, message, publicKey, signature, timestamp } =
						ctx.body

					const result = await validateCredentials(
						{
							type: 'keychain',
							username: username.trim(),
							message,
							publicKey,
							signature,
							timestamp: timestamp ? Number(timestamp) : Date.now(),
						},
						'keychain'
					)

					if (!result.success) {
						throw new APIError('UNAUTHORIZED', {
							message: result.error,
						})
					}

					const { user: appUser } = result
					const email = hiveAuthEmail(appUser.username)
					const existing = await ctx.context.internalAdapter.findUserByEmail(
						email
					)

					const profile = {
						name: appUser.username,
						email,
						emailVerified: true,
						username: appUser.username,
						role: appUser.role,
						authMethod: appUser.auth_method as AuthMethod,
						isActive: appUser.id.length > 0,
					}

					const user = existing
						? await ctx.context.internalAdapter.updateUser(
								existing.user.id,
								profile
							)
						: await ctx.context.internalAdapter.createUser(profile, {
								method: 'hive-keychain',
							})

					const session = await ctx.context.internalAdapter.createSession(
						user.id
					)
					if (!session) {
						throw new APIError('INTERNAL_SERVER_ERROR', {
							message: 'Failed to create session',
						})
					}

					await setSessionCookie(ctx, { session, user })

					return ctx.json({
						success: true,
						user: {
							username: appUser.username,
							role: UserRole.Builder,
						},
					})
				}
			),
		},
	}
}
