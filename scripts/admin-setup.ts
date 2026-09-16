import bcrypt from 'bcryptjs'
import { db, insertAppUser } from '../src/lib/database'
import { UserRole } from '../src/lib/roles'
import readline from 'readline'

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
})

function question(query: string): Promise<string> {
	return new Promise((resolve) => {
		rl.question(query, resolve)
	})
}

async function checkAdminExists(): Promise<boolean> {
	try {
		const result = await db.execute(`SELECT COUNT(*) as count FROM "user" WHERE role = 'admin'`)
		const row = result.rows[0]
		return row && (row.count as number) > 0
	} catch {
		return false
	}
}

async function createAdmin(username: string, password: string) {
	try {
		const passwordHash = await bcrypt.hash(password, 10)

		await insertAppUser({
			username,
			role: UserRole.Admin,
			authMethod: 'password',
			passwordHash,
			isActive: true,
		})

		console.log(`✅ Admin account created successfully!`)
		console.log(`   Username: ${username}`)
		console.log(`   You can now login at /management/access`)
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes('Only one admin allowed')
		) {
			console.error('❌ An admin account already exists.')
			console.log(
				'💡 Use "pnpm admin:reset" to reset the admin password instead.',
			)
		} else {
			console.error('❌ Error creating admin account:', error)
		}
		process.exit(1)
	}
}

async function resetAdminPassword(password: string) {
	try {
		const passwordHash = await bcrypt.hash(password, 10)

		await db.execute({
			sql: `UPDATE "user" SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE role = 'admin'`,
			args: [passwordHash],
		})

		console.log('✅ Admin password reset successfully!')
	} catch (error) {
		console.error('❌ Error resetting admin password:', error)
		process.exit(1)
	}
}

async function getAdminInfo() {
	try {
		const result = await db.execute(`SELECT username, is_active FROM "user" WHERE role = 'admin'`)
		if (result.rows.length > 0) {
			const admin = result.rows[0]
			console.log('👤 Current Admin Account:')
			console.log(`   Username: ${admin.username}`)
			console.log(`   Status: ${admin.is_active ? 'Active' : 'Inactive'}`)
		} else {
			console.log('ℹ️  No admin account exists.')
		}
	} catch (error) {
		console.error('❌ Error fetching admin info:', error)
		process.exit(1)
	}
}

async function showHelp() {
	console.log(`
🔧 Admin Management for HolaHive

Usage:
  pnpm admin:create  - Create a new admin account (interactive)
  pnpm admin:reset   - Reset admin password
  pnpm admin:check   - Check current admin status

Environment Variables (for automated setup):
  ADMIN_USERNAME=admin ADMIN_PASSWORD=SecurePass123! pnpm admin:create

Examples:
  # Interactive creation
  pnpm admin:create

  # Automated creation (CI/CD)
  ADMIN_USERNAME=admin ADMIN_PASSWORD=MySecurePass123! pnpm admin:create

  # Check current admin
  pnpm admin:check

  # Reset password
  pnpm admin:reset
`)
}

async function main() {
	const command = process.argv[2] || 'help'

	console.log('🔧 HolaHive Admin Management\n')

	switch (command) {
		case 'create': {
			const adminExists = await checkAdminExists()
			if (adminExists) {
				console.error('❌ An admin account already exists.')
				console.log(
					'💡 Use "pnpm admin:reset" to reset the password instead.',
				)
				process.exit(1)
			}

			let username = process.env.ADMIN_USERNAME
			let password = process.env.ADMIN_PASSWORD

			if (!username || !password) {
				console.log('📝 Create Admin Account (Interactive Mode)\n')
				username = await question('Enter admin username: ')
				password = await question('Enter admin password: ')
			}

			if (!username || !password) {
				console.error('❌ Username and password are required.')
				process.exit(1)
			}

			if (password.length < 8) {
				console.error('❌ Password must be at least 8 characters long.')
				process.exit(1)
			}

			await createAdmin(username, password)
			break
		}

		case 'reset': {
			const adminExists = await checkAdminExists()
			if (!adminExists) {
				console.error('❌ No admin account exists.')
				console.log('💡 Use "pnpm admin:create" to create one first.')
				process.exit(1)
			}

			let password = process.env.ADMIN_PASSWORD

			if (!password) {
				console.log('🔐 Reset Admin Password\n')
				password = await question('Enter new admin password: ')
			}

			if (!password || password.length < 8) {
				console.error('❌ Password must be at least 8 characters long.')
				process.exit(1)
			}

			await resetAdminPassword(password)
			break
		}

		case 'check':
			await getAdminInfo()
			break

		case 'help':
		default:
			await showHelp()
			break
	}

	rl.close()
}

main()
