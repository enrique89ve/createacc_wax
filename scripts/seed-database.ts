import bcrypt from 'bcryptjs'
import { db, initializeDatabase, insertAdminUser } from '../src/lib/database'
import { UserRole } from '../src/lib/roles'

const SEED_DEFAULTS = {
  ADMIN_USERNAME: process.env.SEED_ADMIN_USERNAME || 'admin',
  BUILDER_USERNAME: process.env.SEED_BUILDER_USERNAME || 'builder-demo',
  TICKET_CODE: process.env.SEED_TICKET_CODE || 'DEMO-TICKET',
  TICKET_CREDITS: 5,
} as const

function requireSeedAdminPassword(): string {
  const password = process.env.SEED_ADMIN_PASSWORD?.trim() ?? ''
  if (password.length < 8) {
    throw new Error(
      'SEED_ADMIN_PASSWORD is required (≥ 8 chars). Refusing a hardcoded seed password.'
    )
  }
  return password
}

async function rowExists(
  table: string,
  column: string,
  value: string
): Promise<boolean> {
  const quoted = table === 'user' ? '"user"' : table
  const result = await db.execute({
    sql: `SELECT COUNT(*) as count FROM ${quoted} WHERE ${column} = ?`,
    args: [value],
  })
  return (result.rows[0]?.count as number) > 0
}

async function seedAdmin(): Promise<string | null> {
  if (await rowExists('user', 'role', UserRole.Admin)) {
    console.log('  Admin already exists, skipping.')
    const result = await db.execute(
      `SELECT id FROM "user" WHERE role = 'admin'`
    )
    return String(result.rows[0]?.id ?? '')
  }

  const passwordHash = await bcrypt.hash(requireSeedAdminPassword(), 10)
  const adminId = await insertAdminUser({
    username: SEED_DEFAULTS.ADMIN_USERNAME,
    passwordHash,
  })
  console.log(`  Admin created: ${SEED_DEFAULTS.ADMIN_USERNAME}`)
  return adminId
}

async function seedBuilderCredits(): Promise<string> {
  if (
    await rowExists('Credits', 'hive_username', SEED_DEFAULTS.BUILDER_USERNAME)
  ) {
    console.log('  Builder credits already exist, skipping.')
    return SEED_DEFAULTS.BUILDER_USERNAME
  }

  await db.execute({
    sql: `INSERT INTO Credits (hive_username, available_amount, total_issued)
			  VALUES (?, 10, 10)`,
    args: [SEED_DEFAULTS.BUILDER_USERNAME],
  })
  console.log(
    `  Credits created: ${SEED_DEFAULTS.BUILDER_USERNAME} (10 credits)`
  )
  return SEED_DEFAULTS.BUILDER_USERNAME
}

async function seedTicket(creatorUsername: string): Promise<void> {
  if (await rowExists('Tickets', 'code', SEED_DEFAULTS.TICKET_CODE)) {
    console.log('  Ticket already exists, skipping.')
    return
  }

  await db.execute({
    sql: `INSERT INTO Tickets (code, description, total_uses, remaining_uses, creator_username)
			  VALUES (?, 'Demo ticket for development', ?, ?, ?)`,
    args: [
      SEED_DEFAULTS.TICKET_CODE,
      SEED_DEFAULTS.TICKET_CREDITS,
      SEED_DEFAULTS.TICKET_CREDITS,
      creatorUsername,
    ],
  })
  console.log(
    `  Ticket created: ${SEED_DEFAULTS.TICKET_CODE} (${SEED_DEFAULTS.TICKET_CREDITS} uses)`
  )
}

async function main() {
  console.log('Seeding database...\n')

  try {
    await initializeDatabase()

    console.log('[1/3] Admin user:')
    const adminId = await seedAdmin()
    if (!adminId) {
      console.error('Failed to create or find admin.')
      process.exit(1)
    }

    console.log('[2/3] Builder credits:')
    const builderUsername = await seedBuilderCredits()

    console.log('[3/3] Demo ticket:')
    await seedTicket(builderUsername)

    console.log('\nSeed completed successfully!\n')
    console.log(
      `  Admin:   ${SEED_DEFAULTS.ADMIN_USERNAME} (password from SEED_ADMIN_PASSWORD)`
    )
    console.log(
      `  Builder: ${SEED_DEFAULTS.BUILDER_USERNAME} (keychain auth, no user row)`
    )
    console.log(`  Ticket:  ${SEED_DEFAULTS.TICKET_CODE}`)
    console.log(`\nLogin at /management/access`)
  } catch (error) {
    console.error('Seed failed:', error)
    process.exit(1)
  }
}

main()
