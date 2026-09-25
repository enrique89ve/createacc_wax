# Database operating checks

HolaHive runs on local SQLite by default. This mode is complete on its own: it
does not need a Turso account, remote connection, embedded sync, or remote backup.
`TURSO_AUTH_TOKEN` by itself does not enable a remote connection.

The optional modes are selected explicitly:

- Remote Turso/libSQL: set `DATABASE_URL` to a remote `libsql://`, `http://`, or
  `https://` URL and provide `TURSO_AUTH_TOKEN`.
Embedded replicas are disabled. The current application does not route all business
writes through a proven authoritative primary, so setting `TURSO_SYNC_URL` fails
fast. Use a direct remote `DATABASE_URL` for optional Turso operation. No live Turso
integration proof exists unless an operator runs the checks against a disposable
remote database.

## Read-only preflight

Run `pnpm db:diagnose` with `DATABASE_URL` set to the database under review. For
local SQLite, the file must already exist. The command does not initialize or
repair schema or balances. It checks required ticket, account, credit, audit,
attempt, event and reconciliation columns, foreign-key enforcement, open attempts,
credit ledger totals, ticket-use conservation, funding snapshots, terminal account
and event counts, and credit refund/consumption references. A critical discrepancy
sets a nonzero exit code. Review its `code`, `entity`, `reference` and `detail`
fields; the report is diagnostic only.

The admin endpoint `GET /api/management/database/diagnose` runs the same read
checks over one read snapshot. It is available only to an admin with credit
management permission.

## Existing installations and schema changes

The application uses `CREATE TABLE IF NOT EXISTS`, not incremental migrations. A
successful `pnpm db:init` does not prove that an old table has the current columns.
Run the read-only preflight before a rollout. If it reports an incompatible schema,
stop the rollout and prepare a version-specific offline conversion in a verified
copy. Do not infer ticket funding or ownership from matching usernames, free-text
reasons, or current Hive account names. Keep ambiguous balances and open attempts
unmodified until their history is reviewed.

Before a cutover, stop API writers and reconcilers, create and verify a consistent
backup, rehearse conversion and restore on a copy, and compare account, ticket,
credit and audit invariants before and after. A backup restore does not reverse a
Hive broadcast; reconcile external effects before restoring or rolling back.

Never run `pnpm db:reset` against a database that contains data to preserve. It is
a destructive helper for disposable local development. Tests and simulations use
separate temporary SQLite files.

For a verified schema-version-1 local SQLite database, the explicit offline
converter can write version 2 to a new path:

```sh
pnpm db:convert:v1-to-v2 --source file:///absolute/path/source.db --destination /absolute/path/new.db
```

It refuses remote sources and existing destinations, validates the source schema,
copies one SQLite snapshot (including committed WAL content), applies the versioned
schema change to that copy, and checks integrity and row counts before publishing
the output. It never changes the source file. Stop application writers first,
retain the original backup, and rehearse the cutover and restore process on a copy.
This converter only handles schema version 1; other versions require their own
reviewed conversion.

## Runtime checks

`pnpm start` and `pnpm dev` initialize a compatible schema, start the Astro server
and the explicit reconciliation scheduler, perform an initial recovery cycle, and
stop the scheduler on shutdown. In SQLite mode, the local process queue coordinates
operations inside one process; SQLite transactions and conditional updates provide
cross-process correctness. The queue is not a distributed lock.

After startup, run `pnpm db:diagnose` and `pnpm state`. An open attempt or manual
review item is not a clean state. Do not release a ticket use merely because a
worker lease expired or retries were exhausted. Inspect the linked transaction and
resolve uncertain Hive outcomes using the documented evidence path.
