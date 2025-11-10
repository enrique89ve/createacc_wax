/**
 * Auth provider configuration for management area
 * Handles admin authentication with password + optional 2FA
 */

import Credentials from '@auth/core/providers/credentials'
import { validatePasswordCredentials } from '@/lib/admin/auth/validators/password-validator'

/**
 * Credentials provider for management area
 * Supports admin and referral user authentication
 */
export const managementProvider = Credentials({
	id: 'management-credentials',
	name: 'Management Login',
	credentials: {
		username: {
			label: 'Username',
			type: 'text',
			placeholder: 'Enter your username'
		},
		password: {
			label: 'Password',
			type: 'password',
			placeholder: 'Enter your password'
		}
	},

	async authorize(credentials) {

		if (!credentials?.username || !credentials?.password) {

			return null
		}

		const result = await validatePasswordCredentials({
			username: credentials.username as string,
			password: credentials.password as string
		})

		if (result.success && result.user) {
			const user = {
				id: result.user.id,
				username: result.user.username,
				role: 'admin', // Unified role system
				auth_method: 'password',
				loginTime: Date.now()
			}

			return user
		}

		return null
	}
})