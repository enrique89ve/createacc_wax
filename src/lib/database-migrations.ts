/** Forward-only schema statements shared by app initialization and offline conversion. */
export const CREDIT_REVISION_MIGRATION_SQL = `
  ALTER TABLE Credits
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
`

export const ADMIN_ACTION_LOG_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS AdminActionLog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT NOT NULL REFERENCES "user" (id) ON DELETE RESTRICT,
    actor_username TEXT NOT NULL,
    request_id TEXT NOT NULL CHECK (length(trim(request_id)) > 0),
    action TEXT NOT NULL CHECK (length(action) > 0),
    target_type TEXT NOT NULL CHECK (length(target_type) > 0),
    target_id TEXT NOT NULL CHECK (length(target_id) > 0),
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
    policy_version INTEGER NOT NULL CHECK (policy_version > 0),
    reason TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'unchanged')),
    before_state TEXT CHECK (before_state IS NULL OR json_valid(before_state)),
    after_state TEXT CHECK (after_state IS NULL OR json_valid(after_state)),
    receipt TEXT NOT NULL CHECK (json_valid(receipt)),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (actor_user_id, request_id)
  )
`

export const ADMIN_ACTION_LOG_INDEX_STATEMENTS: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS idx_admin_action_log_target
    ON AdminActionLog (target_type, target_id, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_admin_action_log_actor
    ON AdminActionLog (actor_user_id, id DESC)`,
]

export const DATABASE_V1_TO_V2_STATEMENTS: readonly string[] = [
  CREDIT_REVISION_MIGRATION_SQL,
  ADMIN_ACTION_LOG_TABLE_SQL,
  ...ADMIN_ACTION_LOG_INDEX_STATEMENTS,
  `UPDATE DatabaseSchemaMetadata
    SET schema_version = 2, applied_at = CURRENT_TIMESTAMP
    WHERE singleton = 1 AND schema_version = 1`,
]
