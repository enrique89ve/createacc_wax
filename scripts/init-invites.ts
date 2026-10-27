import { initializeDatabase } from '@/lib/database'
import { requireInviteIdentitySecret } from '@/lib/invite/crypto'
import { initializeInviteSchema } from '@/lib/invite/schema'

async function main(): Promise<void> {
  const secret = requireInviteIdentitySecret(process.env.INVITE_IDENTITY_SECRET)
  if (!(await initializeDatabase()))
    throw new Error('Base database initialization failed')
  await initializeInviteSchema(secret)
  console.log(
    'Personal invitation schema initialized; existing accounts and tickets preserved.'
  )
}

main().catch(error => {
  console.error(
    error instanceof Error ? error.message : 'Invitation initialization failed'
  )
  process.exitCode = 1
})
