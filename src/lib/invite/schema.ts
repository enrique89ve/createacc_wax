import { execute, withTransaction } from '@/lib/database'
import { inviteSecretFingerprint } from './crypto'

const INVITE_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS InviteSettings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL CHECK (schema_version = 1),
    identity_key_fingerprint TEXT NOT NULL CHECK (length(identity_key_fingerprint) = 64),
    campaign_enabled INTEGER NOT NULL DEFAULT 0 CHECK (campaign_enabled IN (0, 1)),
    campaign_limit INTEGER NOT NULL DEFAULT 0 CHECK (campaign_limit >= 0),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
  )`,
  `CREATE TABLE IF NOT EXISTS InviteGrants (
    identity_hash TEXT PRIMARY KEY CHECK (length(identity_hash) = 64),
    provider TEXT NOT NULL CHECK (provider IN ('github', 'twitter')),
    token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
    ticket_id INTEGER NOT NULL UNIQUE REFERENCES Tickets(id) ON DELETE RESTRICT,
    issued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invite_grants_issued ON InviteGrants(issued_at)`,
  `CREATE TRIGGER IF NOT EXISTS invite_ticket_single_use
    BEFORE UPDATE OF total_uses, code ON Tickets
    WHEN EXISTS (SELECT 1 FROM InviteGrants WHERE ticket_id = OLD.id)
      AND (NEW.total_uses != 1 OR NEW.code != OLD.code)
    BEGIN SELECT RAISE(ABORT, 'Personal invitation tickets are immutable'); END`,
] as const

const INVITE_SETTINGS_COLUMN_MIGRATIONS = [
  [
    'campaign_enabled',
    'INTEGER NOT NULL DEFAULT 0 CHECK (campaign_enabled IN (0, 1))',
  ],
  ['campaign_limit', 'INTEGER NOT NULL DEFAULT 0 CHECK (campaign_limit >= 0)'],
  ['revision', 'INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)'],
] as const

async function inviteSettingsColumns(): Promise<Set<string>> {
  const result = await execute({
    sql: 'PRAGMA table_info(InviteSettings)',
    args: [],
  })
  return new Set(
    result.rows.flatMap(row => (typeof row.name === 'string' ? [row.name] : []))
  )
}

export async function hasInviteSchema(): Promise<boolean> {
  const result = await execute({
    sql: "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('InviteGrants', 'InviteSettings')",
    args: [],
  })
  const count = Number(result.rows[0]?.count)
  if (count !== 0 && count !== 2) {
    throw new Error('Incomplete invitation schema')
  }
  return count === 2
}

export async function requireInviteSchemaKey(secret: string): Promise<void> {
  const columns = await inviteSettingsColumns()
  if (
    !['campaign_enabled', 'campaign_limit', 'revision'].every(column =>
      columns.has(column)
    )
  ) {
    throw new Error(
      'Invitation campaign settings require schema initialization'
    )
  }
  const result = await execute({
    sql: 'SELECT schema_version, identity_key_fingerprint FROM InviteSettings WHERE singleton = 1',
    args: [],
  })
  const row = result.rows[0]
  if (
    row?.schema_version !== 1 ||
    row.identity_key_fingerprint !== inviteSecretFingerprint(secret)
  ) {
    throw new Error(
      'Invitation schema or identity key does not match; preserve INVITE_IDENTITY_SECRET'
    )
  }
}

/** Explicit additive setup; never called from an HTTP request or app bootstrap. */
export async function initializeInviteSchema(secret: string): Promise<void> {
  const fingerprint = inviteSecretFingerprint(secret)
  await withTransaction(async () => {
    for (const sql of INVITE_SCHEMA_STATEMENTS) await execute({ sql, args: [] })
    await execute({
      sql: 'INSERT INTO InviteSettings (singleton, schema_version, identity_key_fingerprint) VALUES (1, 1, ?) ON CONFLICT(singleton) DO NOTHING',
      args: [fingerprint],
    })
    const setting = await execute({
      sql: 'SELECT identity_key_fingerprint FROM InviteSettings WHERE singleton = 1',
      args: [],
    })
    if (setting.rows[0]?.identity_key_fingerprint !== fingerprint) {
      throw new Error(
        'Invitation identity key does not match; preserve INVITE_IDENTITY_SECRET'
      )
    }
    let columns = await inviteSettingsColumns()
    for (const [column, declaration] of INVITE_SETTINGS_COLUMN_MIGRATIONS) {
      if (columns.has(column)) continue
      await execute({
        sql: `ALTER TABLE InviteSettings ADD COLUMN ${column} ${declaration}`,
        args: [],
      })
      columns = await inviteSettingsColumns()
    }
    await requireInviteSchemaKey(secret)
  })
}
