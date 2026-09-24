import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@libsql/client'

let directory = ''
let legacyDatabasePath = ''

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'holahive-schema-guard-'))
  legacyDatabasePath = join(directory, 'legacy.db')
  const client = createClient({ url: `file:${legacyDatabasePath}` })
  await client.execute({
    sql: 'CREATE TABLE Tickets (code TEXT PRIMARY KEY)',
    args: [],
  })
  client.close()
})

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('existing schema guard', () => {
  it('rejects an incompatible database before adding partial current tables', async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', resolve(process.cwd(), 'scripts/init-database.ts')],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: `file:${legacyDatabasePath}`,
          TURSO_AUTH_TOKEN: '',
          TURSO_SYNC_URL: '',
        },
        stdio: ['ignore', 'ignore', 'ignore'],
      }
    )
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once('error', reject)
      child.once('exit', code => resolveExit(code))
    })
    expect(exitCode).toBe(1)

    const client = createClient({ url: `file:${legacyDatabasePath}` })
    const tables = await client.execute({
      sql: `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      args: [],
    })
    expect(tables.rows.map(row => row.name)).toEqual(['Tickets'])
    client.close()
  }, 30_000)
})
