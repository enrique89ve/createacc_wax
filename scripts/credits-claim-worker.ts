import './test-setup-env.ts'
import { completeClaim } from '@/lib/credits/claim-service'
import type { VerifiedHiveClaim } from '@/lib/credits/adapters/hive-claim-adapter'

async function main(): Promise<void> {
  const rawProof = process.argv[2]
  if (!rawProof) throw new Error('Missing claim proof')

  const proof = JSON.parse(rawProof) as VerifiedHiveClaim
  const result = await completeClaim(proof)
  process.stdout.write(JSON.stringify(result))
}

main().catch(error => {
  process.stderr.write(error instanceof Error ? error.message : 'Unknown error')
  process.exitCode = 1
})
