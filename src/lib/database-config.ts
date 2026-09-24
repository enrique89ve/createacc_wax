import type { Config } from '@libsql/client'

const LOCAL_DATABASE_URL = 'file:holahive.db'
export type DatabaseMode = 'sqlite-local' | 'turso-remote'

export interface DatabaseEnvironment {
  readonly DATABASE_URL?: string
  readonly TURSO_AUTH_TOKEN?: string
  readonly TURSO_SYNC_URL?: string
  readonly TURSO_SYNC_INTERVAL_MS?: string
}

export interface ResolvedDatabaseConfiguration {
  readonly mode: DatabaseMode
  readonly client: Config
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized
}

function isRemoteDatabaseUrl(url: string): boolean {
  return /^(libsql|https?):\/\//i.test(url)
}

/** Select a DB mode explicitly; unselected Turso credentials never enable sync. */
export function resolveDatabaseConfiguration(
  environment: DatabaseEnvironment
): ResolvedDatabaseConfiguration {
  const url = nonEmpty(environment.DATABASE_URL) ?? LOCAL_DATABASE_URL
  const authToken = nonEmpty(environment.TURSO_AUTH_TOKEN)
  const syncUrl = nonEmpty(environment.TURSO_SYNC_URL)

  if (url.startsWith('file:')) {
    if (syncUrl) {
      throw new Error(
        'Embedded replica writes are disabled until an authoritative remote write path is configured; use DATABASE_URL with a remote URL instead'
      )
    }
    return { mode: 'sqlite-local', client: { url } }
  }

  if (syncUrl) {
    throw new Error(
      'TURSO_SYNC_URL is not supported; select local SQLite or a direct remote DATABASE_URL'
    )
  }
  if (!isRemoteDatabaseUrl(url)) {
    throw new Error('DATABASE_URL must use file:, libsql:, http:, or https:')
  }
  if (!authToken) {
    throw new Error('TURSO_AUTH_TOKEN is required for a remote database URL')
  }
  return {
    mode: 'turso-remote',
    client: { url, authToken },
  }
}
