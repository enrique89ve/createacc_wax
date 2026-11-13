#!/bin/sh
set -eu

# Dokploy named/bind volumes hide the image's /data ownership. SQLite error 14
# (SQLITE_CANTOPEN) is the usual result when `node` cannot create holahive.db.
if [ -z "${DATABASE_URL:-}" ]; then
  export DATABASE_URL="file:/data/holahive.db"
fi

mkdir -p /data /app/storage_root-node/.beekeeper

if [ "$(id -u)" = "0" ]; then
  chown -R node:node /data /app/storage_root-node
  exec gosu node "$@"
fi

exec "$@"
