import { createClient, type Client } from '@libsql/client'
import { lstat, link, mkdtemp, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DATABASE_V1_TO_V2_STATEMENTS } from '../src/lib/database-migrations'
import {
  DATABASE_SCHEMA_VERSION,
  REQUIRED_DATABASE_COLUMNS,
} from '../src/lib/database-schema-contract'

const SOURCE_SCHEMA_VERSION = 1

interface DatabaseInspection {
  readonly tables: ReadonlySet<string>
  readonly rowCounts: ReadonlyMap<string, number>
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function getLegacyRequiredColumns(): ReadonlyMap<string, readonly string[]> {
  const columnsByTable = new Map<string, readonly string[]>()
  for (const [table, columns] of Object.entries(REQUIRED_DATABASE_COLUMNS)) {
    if (table === 'AdminActionLog') continue
    columnsByTable.set(
      table,
      table === 'Credits'
        ? columns.filter(column => column !== 'revision')
        : columns
    )
  }
  return columnsByTable
}

async function inspectDatabase(client: Client): Promise<DatabaseInspection> {
  const tablesResult = await client.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT GLOB 'sqlite_*' ORDER BY name`
  )
  const tables = new Set(tablesResult.rows.map(row => String(row.name)))
  const rowCounts = new Map<string, number>()
  for (const table of tables) {
    const result = await client.execute(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table)}`
    )
    rowCounts.set(table, Number(result.rows[0]?.count ?? 0))
  }
  return { tables, rowCounts }
}

async function assertDatabaseIntegrity(client: Client): Promise<void> {
  const quickCheck = await client.execute('PRAGMA quick_check')
  if (
    quickCheck.rows.length !== 1 ||
    String(quickCheck.rows[0]?.quick_check).toLowerCase() !== 'ok'
  ) {
    throw new Error('Database integrity check failed')
  }
  const foreignKeyCheck = await client.execute('PRAGMA foreign_key_check')
  if (foreignKeyCheck.rows.length > 0) {
    throw new Error('Database has foreign key violations')
  }
}

function assertRowCountsMatch(
  expected: DatabaseInspection,
  actual: DatabaseInspection,
  description: string,
  allowedAddedTables: readonly string[] = []
): void {
  const allowedAddedTableSet = new Set(allowedAddedTables)
  const changedTables = new Set<string>()
  for (const [table, rowCount] of expected.rowCounts) {
    if (actual.rowCounts.get(table) !== rowCount) changedTables.add(table)
  }
  for (const table of actual.tables) {
    if (!expected.tables.has(table) && !allowedAddedTableSet.has(table)) {
      changedTables.add(table)
    }
  }
  if (changedTables.size > 0) {
    throw new Error(`${description}: ${[...changedTables].sort().join(', ')}`)
  }
}

async function assertVersionOneSchema(
  client: Client
): Promise<DatabaseInspection> {
  await assertDatabaseIntegrity(client)
  const inspection = await inspectDatabase(client)
  const missingTables: string[] = []
  const missingColumns: string[] = []

  for (const [table, requiredColumns] of getLegacyRequiredColumns()) {
    if (!inspection.tables.has(table)) {
      missingTables.push(table)
      continue
    }
    const columnsResult = await client.execute(
      `PRAGMA table_info(${quoteIdentifier(table)})`
    )
    const existingColumns = new Set(
      columnsResult.rows.map(row => String(row.name))
    )
    for (const column of requiredColumns) {
      if (!existingColumns.has(column)) {
        missingColumns.push(`${table}.${column}`)
      }
    }
  }

  if (inspection.tables.has('AdminActionLog')) {
    throw new Error(
      'Source schema already contains AdminActionLog and is not version 1'
    )
  }
  const creditsColumns = await client.execute('PRAGMA table_info(Credits)')
  if (creditsColumns.rows.some(row => row.name === 'revision')) {
    throw new Error(
      'Source schema already contains Credits.revision and is not version 1'
    )
  }
  if (missingTables.length > 0 || missingColumns.length > 0) {
    throw new Error(
      `Source schema is incompatible; missing tables [${missingTables.join(', ')}], missing columns [${missingColumns.join(', ')}]`
    )
  }

  const versionResult = await client.execute(
    'SELECT schema_version FROM DatabaseSchemaMetadata WHERE singleton = 1'
  )
  const schemaVersion = Number(versionResult.rows[0]?.schema_version)
  if (schemaVersion !== SOURCE_SCHEMA_VERSION) {
    throw new Error(
      `Expected source schema version 1, found ${String(versionResult.rows[0]?.schema_version ?? 'missing')}`
    )
  }
  return inspection
}

function getSourcePath(sourceUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    throw new Error('Source must be an absolute file: URL')
  }
  if (parsed.protocol !== 'file:' || parsed.search || parsed.hash) {
    throw new Error(
      'Source must be a local file: URL without query or fragment'
    )
  }
  return fileURLToPath(parsed)
}

async function assertConvertedDatabase(
  client: Client,
  sourceInspection: DatabaseInspection
): Promise<void> {
  await assertDatabaseIntegrity(client)
  const versionResult = await client.execute(
    'SELECT schema_version FROM DatabaseSchemaMetadata WHERE singleton = 1'
  )
  const schemaVersion = Number(versionResult.rows[0]?.schema_version)
  if (schemaVersion !== DATABASE_SCHEMA_VERSION) {
    throw new Error(
      `Converted database schema version is ${schemaVersion}, expected ${DATABASE_SCHEMA_VERSION}`
    )
  }

  const inspection = await inspectDatabase(client)
  assertRowCountsMatch(
    sourceInspection,
    inspection,
    'Conversion changed source row counts for',
    ['AdminActionLog']
  )
  if (!inspection.tables.has('AdminActionLog')) {
    throw new Error('Converted database is missing AdminActionLog')
  }
  if (inspection.rowCounts.get('AdminActionLog') !== 0) {
    throw new Error('AdminActionLog must start empty after conversion')
  }
  const revisionResult = await client.execute(
    'SELECT COUNT(*) AS count FROM Credits WHERE revision <> 0'
  )
  if (Number(revisionResult.rows[0]?.count ?? 0) !== 0) {
    throw new Error('New Credits.revision values must start at zero')
  }
}

export async function convertDatabaseV1ToV2(params: {
  readonly sourceUrl: string
  readonly destinationPath: string
}): Promise<void> {
  const sourcePath = await realpath(getSourcePath(params.sourceUrl))
  const requestedDestination = resolve(params.destinationPath)
  const destinationParent = await realpath(dirname(requestedDestination))
  const destinationPath = join(
    destinationParent,
    basename(requestedDestination)
  )
  if (sourcePath === destinationPath) {
    throw new Error('Source and destination must be different files')
  }
  let destinationExists = false
  try {
    await lstat(destinationPath)
    destinationExists = true
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error
    }
  }
  if (destinationExists) {
    throw new Error('Destination already exists; choose a new output path')
  }

  const temporaryDirectory = await mkdtemp(
    join(destinationParent, `.${basename(destinationPath)}.conversion-`)
  )
  const snapshotPath = join(temporaryDirectory, 'snapshot.db')
  let sourceClient: Client | undefined
  let snapshotClient: Client | undefined
  try {
    sourceClient = createClient({ url: pathToFileURL(sourcePath).href })
    const sourceInspection = await assertVersionOneSchema(sourceClient)
    await sourceClient.execute({
      sql: 'VACUUM INTO ?',
      args: [snapshotPath],
    })
    sourceClient.close()
    sourceClient = undefined

    snapshotClient = createClient({ url: pathToFileURL(snapshotPath).href })
    const snapshotInspection = await assertVersionOneSchema(snapshotClient)
    assertRowCountsMatch(
      sourceInspection,
      snapshotInspection,
      'Source changed while the snapshot was being created'
    )
    const transaction = await snapshotClient.transaction('write')
    try {
      for (const sql of DATABASE_V1_TO_V2_STATEMENTS) {
        await transaction.execute(sql)
      }
      await transaction.commit()
    } catch (error) {
      await transaction.rollback()
      throw error
    } finally {
      transaction.close()
    }
    await assertConvertedDatabase(snapshotClient, snapshotInspection)
    snapshotClient.close()
    snapshotClient = undefined

    // link() publishes atomically and fails if another process created the target meanwhile.
    await link(snapshotPath, destinationPath)
  } finally {
    sourceClient?.close()
    snapshotClient?.close()
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}

function parseArguments(args: readonly string[]): {
  readonly sourceUrl: string
  readonly destinationPath: string
} {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]
    const value = args[index + 1]
    if (
      (option !== '--source' && option !== '--destination') ||
      !value ||
      values.has(option)
    ) {
      throw new Error(
        'Usage: pnpm db:convert:v1-to-v2 --source file:///path/source.db --destination /path/new.db'
      )
    }
    values.set(option, value)
  }
  const sourceUrl = values.get('--source')
  const destinationPath = values.get('--destination')
  if (!sourceUrl || !destinationPath || values.size !== 2) {
    throw new Error(
      'Usage: pnpm db:convert:v1-to-v2 --source file:///path/source.db --destination /path/new.db'
    )
  }
  return { sourceUrl, destinationPath }
}

if (process.argv[1]?.endsWith('convert-database-v1-to-v2.ts')) {
  try {
    const params = parseArguments(process.argv.slice(2))
    await convertDatabaseV1ToV2(params)
    process.stdout.write(
      `Converted database written to ${resolve(params.destinationPath)}\n`
    )
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exitCode = 1
  }
}
