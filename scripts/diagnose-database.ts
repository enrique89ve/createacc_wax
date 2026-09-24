import './test-setup-env.ts'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

function assertLocalDatabaseExists(): void {
  const configuredUrl = process.env.DATABASE_URL?.trim() || 'file:holahive.db'
  if (!configuredUrl.startsWith('file:')) return
  const localPath = configuredUrl.slice('file:'.length).split('?')[0]
  if (!existsSync(resolve(process.cwd(), decodeURIComponent(localPath)))) {
    throw new Error(`SQLite database file does not exist: ${localPath}`)
  }
}

async function main(): Promise<void> {
  assertLocalDatabaseExists()
  const [{ inspectDatabaseSchema }, { diagnoseDatabaseConsistency }] =
    await Promise.all([
      import('@/lib/database-schema-preflight'),
      import('@/lib/database-diagnostics'),
    ])
  const { withReadSnapshot } = await import('@/lib/database')
  const report = await withReadSnapshot(async () => {
    const preflight = await inspectDatabaseSchema()
    if (!preflight.schemaCompatible || !preflight.foreignKeysEnabled) {
      return { preflight, diagnostics: null }
    }
    return {
      preflight,
      diagnostics: await diagnoseDatabaseConsistency(),
    }
  })
  console.log(JSON.stringify(report, null, 2))
  if (
    !report.preflight.schemaCompatible ||
    !report.preflight.foreignKeysEnabled ||
    (report.diagnostics?.criticalCount ?? 0) > 0
  ) {
    process.exitCode = 1
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  console.error(`Database diagnosis failed: ${message}`)
  process.exitCode = 1
})
