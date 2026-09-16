import './test-setup-env.ts'
import { collectWaxDiagnostics } from '@/lib/wax-diagnostics'

function line(label: string, ok: boolean, extra = ''): void {
  const status = ok ? 'PASS' : 'FAIL'
  console.log(`${label.padEnd(24)} ${status}${extra ? `  ${extra}` : ''}`)
}

async function main(): Promise<void> {
  console.log('HolaHive WAX Self Test')
  console.log('────────────────────────────────')
  console.log('')

  const diagnostics = await collectWaxDiagnostics()
  const tx = diagnostics.transaction
  const creatorOk = diagnostics.creator.exists
  const claimedOk = diagnostics.creator.claimedAccounts > 0
  const rcOk =
    diagnostics.creator.rcPercent === undefined ||
    diagnostics.creator.rcPercent > 0
  const noopInjected = diagnostics.broadcast.injectedNoop
  const notBroadcasted = tx.broadcasted === false

  line('WAX', true, diagnostics.waxVersion)
  line('Hive Mainnet', diagnostics.hive.connected, diagnostics.hive.endpoint)
  line('RPC', diagnostics.hive.connected)
  line('Creator account', creatorOk)
  line(
    'Claimed accounts',
    claimedOk,
    String(diagnostics.creator.claimedAccounts)
  )
  line(
    'RC',
    rcOk,
    diagnostics.creator.rcPercent !== undefined
      ? `${diagnostics.creator.rcPercent}%`
      : 'n/a'
  )
  console.log('')
  line('createTransaction', tx.created)
  line('create_claimed_account', tx.created)
  line('validate', tx.validated)
  line('on-chain verification', tx.onChainVerified)
  line('Beekeeper', tx.signed)
  line('signature', tx.signed)
  line('authority', tx.authorityVerified)
  line('broadcast suppressed', notBroadcasted && noopInjected)
  console.log('')
  console.log(
    `Env execution mode     ${diagnostics.broadcast.mode.toUpperCase()}`
  )
  console.log('Self-test broadcast    NO-OP (injected)')
  console.log('')
  console.log('────────────────────────────────')

  const passed =
    diagnostics.hive.connected &&
    creatorOk &&
    claimedOk &&
    tx.created &&
    tx.validated &&
    tx.onChainVerified &&
    tx.signed &&
    tx.authorityVerified &&
    notBroadcasted &&
    noopInjected

  if (!passed) {
    console.log('WAX SIMULATION FAILED')
    process.exit(1)
  }
  console.log('WAX SIMULATION PASSED')
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  console.error(message)
  process.exit(1)
})
