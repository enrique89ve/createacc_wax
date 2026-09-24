import {
  databaseConfiguration,
  execute,
  withReadSnapshot,
} from '@/lib/database'
import {
  DATABASE_SCHEMA_VERSION,
  findDatabaseSchemaGaps,
  REQUIRED_DATABASE_COLUMNS,
} from '@/lib/database-schema-contract'

export interface DatabaseSchemaPreflight {
  readonly generatedAt: string
  readonly databaseMode: string
  readonly schemaVersion: number | null
  readonly expectedSchemaVersion: number
  readonly schemaCompatible: boolean
  readonly foreignKeysEnabled: boolean
  readonly missingTables: readonly string[]
  readonly missingColumns: readonly string[]
  readonly openCreationAttempts: number | null
  readonly errors: readonly string[]
}

type Row = Record<string, unknown>

export async function inspectDatabaseSchema(): Promise<DatabaseSchemaPreflight> {
  return withReadSnapshot(async () => {
    const errors: string[] = []
    const tableResult = await execute({
      sql: `SELECT name FROM sqlite_master WHERE type = 'table'`,
      args: [],
    })
    const existingTables = new Set(
      tableResult.rows.map(row => String((row as Row).name))
    )
    const columnsByTable = new Map<string, ReadonlySet<string>>()

    for (const table of Object.keys(REQUIRED_DATABASE_COLUMNS)) {
      if (!existingTables.has(table)) continue
      const columns = await execute({
        sql: `PRAGMA table_info(${table})`,
        args: [],
      })
      columnsByTable.set(
        table,
        new Set(columns.rows.map(row => String((row as Row).name)))
      )
    }
    const { missingTables, missingColumns } = findDatabaseSchemaGaps({
      tables: existingTables,
      columnsByTable,
    })
    let schemaVersion: number | null = null
    if (!missingTables.includes('DatabaseSchemaMetadata')) {
      const versionResult = await execute({
        sql: 'SELECT schema_version FROM DatabaseSchemaMetadata WHERE singleton = 1',
        args: [],
      })
      const value = Number(versionResult.rows[0]?.schema_version)
      schemaVersion = Number.isSafeInteger(value) ? value : null
    }

    const foreignKeys = await execute({ sql: 'PRAGMA foreign_keys', args: [] })
    const foreignKeysEnabled =
      Number((foreignKeys.rows[0] as Row | undefined)?.foreign_keys) === 1
    if (!foreignKeysEnabled) errors.push('Foreign key enforcement is disabled')

    let openCreationAttempts: number | null = null
    if (!missingTables.includes('CreationAttempts')) {
      const open = await execute({
        sql: `SELECT COUNT(*) AS count FROM CreationAttempts
              WHERE status IN ('reserved', 'prepared', 'broadcasting')`,
        args: [],
      })
      openCreationAttempts = Number(
        (open.rows[0] as Row | undefined)?.count ?? 0
      )
    }

    if (missingTables.length > 0) {
      errors.push(`Missing tables: ${missingTables.join(', ')}`)
    }
    if (missingColumns.length > 0) {
      errors.push(`Missing columns: ${missingColumns.join(', ')}`)
    }
    if (schemaVersion !== DATABASE_SCHEMA_VERSION) {
      errors.push(
        `Schema version mismatch: expected ${DATABASE_SCHEMA_VERSION}, actual ${schemaVersion ?? 'missing'}`
      )
    }

    return {
      generatedAt: new Date().toISOString(),
      databaseMode: databaseConfiguration.mode,
      schemaVersion,
      expectedSchemaVersion: DATABASE_SCHEMA_VERSION,
      schemaCompatible:
        missingTables.length === 0 &&
        missingColumns.length === 0 &&
        schemaVersion === DATABASE_SCHEMA_VERSION,
      foreignKeysEnabled,
      missingTables,
      missingColumns,
      openCreationAttempts,
      errors,
    }
  })
}
