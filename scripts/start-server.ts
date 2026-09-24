import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { initializeDatabase } from '@/lib/database'
import { startAutoReconciler, stopAutoReconciler } from '@/lib/auto-reconciler'

interface AstroStandaloneEntry {
  readonly startServer: () => void
}

async function startServer(): Promise<void> {
  if (!(await initializeDatabase())) {
    throw new Error(
      'Database schema initialization failed; run the database preflight before starting the server.'
    )
  }

  startAutoReconciler()
  const stopOnSignal = (signal: NodeJS.Signals): void => {
    const resumeTermination = (): void => {
      process.removeListener(signal, onSigint)
      process.removeListener(signal, onSigterm)
      process.kill(process.pid, signal)
    }
    stopAutoReconciler().then(resumeTermination, error => {
      const detail =
        error instanceof Error ? error.message : 'Unknown shutdown error'
      console.error(`[server] Reconciler shutdown failed: ${detail}`)
      resumeTermination()
    })
  }
  const onSigint = (): void => stopOnSignal('SIGINT')
  const onSigterm = (): void => stopOnSignal('SIGTERM')
  process.once('SIGINT', onSigint)
  process.once('SIGTERM', onSigterm)
  process.once('beforeExit', async () => {
    await stopAutoReconciler()
  })

  process.env.ASTRO_NODE_AUTOSTART = 'disabled'
  const entryUrl = pathToFileURL(resolve('dist/server/entry.mjs')).href
  const entry = (await import(entryUrl)) as AstroStandaloneEntry
  entry.startServer()
}

startServer().catch(async error => {
  await stopAutoReconciler()
  const message =
    error instanceof Error ? error.message : 'Unknown startup error'
  console.error(`[server] ${message}`)
  process.exit(1)
})
