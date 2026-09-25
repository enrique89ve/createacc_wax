import { createClient } from '@libsql/client'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { convertDatabaseV1ToV2 } from '../../scripts/convert-database-v1-to-v2'
import { REQUIRED_DATABASE_COLUMNS } from './database-schema-contract'

const directories: string[] = []

async function createVersionOneDatabase(path: string): Promise<void> {
  const client = createClient({ url: `file:${path}` })
  try {
    await client.execute(`CREATE TABLE DatabaseSchemaMetadata (
      singleton INTEGER PRIMARY KEY,
      schema_version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
    await client.execute(
      'INSERT INTO DatabaseSchemaMetadata (singleton, schema_version) VALUES (1, 1)'
    )
    await client.execute('CREATE TABLE "user" (id TEXT PRIMARY KEY)')
    await client.execute(`CREATE TABLE Credits (
      hive_username TEXT PRIMARY KEY,
      pending_amount INTEGER NOT NULL DEFAULT 0,
      available_amount INTEGER NOT NULL DEFAULT 0,
      total_issued INTEGER NOT NULL DEFAULT 0,
      total_consumed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`)

    for (const [table, columns] of Object.entries(REQUIRED_DATABASE_COLUMNS)) {
      if (
        table === 'DatabaseSchemaMetadata' ||
        table === 'Credits' ||
        table === 'AdminActionLog'
      ) {
        continue
      }
      const definitions = columns.map(column => `"${column}" TEXT`).join(', ')
      await client.execute(`CREATE TABLE "${table}" (${definitions})`)
    }
    await client.execute({
      sql: `INSERT INTO Credits
        (hive_username, pending_amount, available_amount, total_issued, total_consumed)
        VALUES (?, ?, ?, ?, ?)`,
      args: ['builder-one', 9, 4, 13, 0],
    })
    await client.execute({
      sql: 'INSERT INTO Tickets (id, code, total_uses, remaining_uses) VALUES (?, ?, ?, ?)',
      args: ['ticket-1', 'TICKET-ONE', '4', '3'],
    })
  } finally {
    client.close()
  }
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'holahive-db-migration-'))
  directories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map(directory => rm(directory, { recursive: true, force: true }))
  )
})

describe('offline database v1 to v2 conversion', () => {
  it('publishes a validated copy while preserving the source and its rows', async () => {
    const directory = await createTemporaryDirectory()
    const sourcePath = join(directory, 'source.db')
    const destinationPath = join(directory, 'converted.db')
    await createVersionOneDatabase(sourcePath)

    await convertDatabaseV1ToV2({
      sourceUrl: `file:${sourcePath}`,
      destinationPath,
    })

    const source = createClient({ url: `file:${sourcePath}` })
    const destination = createClient({ url: `file:${destinationPath}` })
    try {
      const sourceVersion = await source.execute(
        'SELECT schema_version FROM DatabaseSchemaMetadata WHERE singleton = 1'
      )
      const destinationVersion = await destination.execute(
        'SELECT schema_version FROM DatabaseSchemaMetadata WHERE singleton = 1'
      )
      expect(Number(sourceVersion.rows[0]?.schema_version)).toBe(1)
      expect(Number(destinationVersion.rows[0]?.schema_version)).toBe(2)

      const sourceCreditsColumns = await source.execute(
        'PRAGMA table_info(Credits)'
      )
      const destinationCreditsColumns = await destination.execute(
        'PRAGMA table_info(Credits)'
      )
      expect(
        sourceCreditsColumns.rows.some(row => row.name === 'revision')
      ).toBe(false)
      expect(
        destinationCreditsColumns.rows.some(row => row.name === 'revision')
      ).toBe(true)

      const credits = await destination.execute(
        'SELECT pending_amount, available_amount, total_issued, revision FROM Credits WHERE hive_username = ?',
        ['builder-one']
      )
      expect(credits.rows[0]).toMatchObject({
        pending_amount: 9,
        available_amount: 4,
        total_issued: 13,
        revision: 0,
      })
      const ticket = await destination.execute(
        'SELECT code, total_uses, remaining_uses FROM Tickets WHERE id = ?',
        ['ticket-1']
      )
      expect(ticket.rows[0]).toMatchObject({
        code: 'TICKET-ONE',
        total_uses: '4',
        remaining_uses: '3',
      })
      const actionLog = await destination.execute(
        'SELECT COUNT(*) AS count FROM AdminActionLog'
      )
      expect(Number(actionLog.rows[0]?.count)).toBe(0)
    } finally {
      source.close()
      destination.close()
    }
  })

  it('rejects a non-v1 source and never publishes a destination', async () => {
    const directory = await createTemporaryDirectory()
    const sourcePath = join(directory, 'source.db')
    const destinationPath = join(directory, 'converted.db')
    await createVersionOneDatabase(sourcePath)
    const source = createClient({ url: `file:${sourcePath}` })
    await source.execute(
      'UPDATE DatabaseSchemaMetadata SET schema_version = 3 WHERE singleton = 1'
    )
    source.close()

    await expect(
      convertDatabaseV1ToV2({
        sourceUrl: `file:${sourcePath}`,
        destinationPath,
      })
    ).rejects.toThrow('Expected source schema version 1, found 3')
    await expect(rm(destinationPath)).rejects.toThrow()
  })

  it('refuses to overwrite an existing destination', async () => {
    const directory = await createTemporaryDirectory()
    const sourcePath = join(directory, 'source.db')
    const destinationPath = join(directory, 'converted.db')
    await createVersionOneDatabase(sourcePath)
    const existing = createClient({ url: `file:${destinationPath}` })
    await existing.execute('CREATE TABLE keep_me (value TEXT)')
    existing.close()

    await expect(
      convertDatabaseV1ToV2({
        sourceUrl: `file:${sourcePath}`,
        destinationPath,
      })
    ).rejects.toThrow('Destination already exists')

    const preserved = createClient({ url: `file:${destinationPath}` })
    try {
      const table = await preserved.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'keep_me'"
      )
      expect(table.rows).toHaveLength(1)
    } finally {
      preserved.close()
    }
  })
})
