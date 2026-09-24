import { spawn, type ChildProcess } from 'node:child_process'
import { initializeDatabase } from '@/lib/database'
import { startAutoReconciler, stopAutoReconciler } from '@/lib/auto-reconciler'

async function startDevelopmentServer(): Promise<void> {
  if (!(await initializeDatabase())) {
    throw new Error(
      'Database schema initialization failed; run the database preflight before starting the server.'
    )
  }

  startAutoReconciler()
  const astroArguments = ['exec', 'astro', 'dev']
  if (process.env.PORT) astroArguments.push('--port', process.env.PORT)
  if (process.env.HOST) astroArguments.push('--host', process.env.HOST)
  const child: ChildProcess = spawn('pnpm', astroArguments, {
    cwd: process.cwd(),
    env: { ...process.env, ASTRO_DEV_BACKGROUND: 'foreground' },
    stdio: 'inherit',
  })
  let childExited = false

  const shutdown = async (signal?: NodeJS.Signals): Promise<void> => {
    await stopAutoReconciler()
    if (!childExited && signal) child.kill(signal)
  }
  const onSigint = async (): Promise<void> => shutdown('SIGINT')
  const onSigterm = async (): Promise<void> => shutdown('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)

  child.once('error', async error => {
    await stopAutoReconciler()
    console.error(`[dev-server] ${error.message}`)
    process.exitCode = 1
  })
  child.once('exit', async (code, signal) => {
    childExited = true
    await stopAutoReconciler()
    process.removeListener('SIGINT', onSigint)
    process.removeListener('SIGTERM', onSigterm)
    process.exitCode =
      code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
  })
}

startDevelopmentServer().catch(async error => {
  await stopAutoReconciler()
  const message =
    error instanceof Error ? error.message : 'Unknown startup error'
  console.error(`[dev-server] ${message}`)
  process.exitCode = 1
})
