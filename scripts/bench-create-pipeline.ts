import './test-setup-env.ts'
import { performance } from 'node:perf_hooks'
import { runAccountCreationPreflight } from '@/lib/hive-preflight'
import { HiveKeys } from '@/lib/create/get-keys'
import { createAccount } from '@/lib/create/create-account'
import { getHiveExecutionMode } from '@/lib/hive-execution-mode'

async function main(): Promise<void> {
  const user = `hhbench${Date.now().toString(36).slice(-6)}`
  const t0 = performance.now()
  let t = t0

  const keys = await HiveKeys.generate(user)
  const tKeys = performance.now()
  const params = keys.toCreateAccountParams(user)

  await runAccountCreationPreflight(params)
  const tPreflight = performance.now()

  const tx = await createAccount(params, {
    executionMode: getHiveExecutionMode(),
  })
  const tCreate = performance.now()

  console.log('Internal pipeline benchmark (simulate)')
  console.log('─'.repeat(40))
  console.log(`HiveKeys.generate     ${(tKeys - t).toFixed(0).padStart(6)}ms`)
  console.log(`runAccountPreflight   ${(tPreflight - tKeys).toFixed(0).padStart(6)}ms`)
  console.log(`createAccount (WAX)   ${(tCreate - tPreflight).toFixed(0).padStart(6)}ms`)
  console.log('─'.repeat(40))
  console.log(`TOTAL                 ${(tCreate - t0).toFixed(0).padStart(6)}ms`)
  console.log(`tx=${tx.id.slice(0, 16)} broadcasted=${tx.broadcasted}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
