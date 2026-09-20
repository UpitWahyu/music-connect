#!/usr/bin/env bash
# Music Connect — MySQL backup with retention (7 days).
# Reads DATABASE_URL from the root .env (gitignored); nothing secret here.
# Install in cron, e.g.:
#   0 3 * * * /root/music-connect/scripts/backup-db.sh >> /var/log/music-backup.log 2>&1
set -euo pipefail
# SEC-19: backups may contain credentials and user data — keep them private.
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
BACKUP_DIR="${BACKUP_DIR:-/root/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"

[ -f "$ENV_FILE" ] || { echo "[backup] .env not found" >&2; exit 1; }

# parse mysql://user:pass@host:port/db from DATABASE_URL
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
USER_="$(echo "$DATABASE_URL" | sed -E 's#mysql://([^:]+):.*#\1#')"
PASS="$(echo "$DATABASE_URL" | sed -E 's#mysql://[^:]+:([^@]+)@.*#\1#')"
HOST="$(echo "$DATABASE_URL" | sed -E 's#mysql://[^@]+@([^:/]+).*#\1#')"
PORT="$(echo "$DATABASE_URL" | sed -E 's#mysql://[^@]+@[^:]+:([0-9]+)/.*#\1#')"
DB="$(echo "$DATABASE_URL" | sed -E 's#mysql://.*/([^?]+).*#\1#')"
PORT="${PORT:-3306}"

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/$DB-$STAMP.sql.gz"

# SEC-19: pass the password via MYSQL_PWD instead of -p"$PASS" so it never
# shows up in `ps` / the process table on the host or inside the container.
export MYSQL_PWD="$PASS"

if docker ps --format '{{.Names}}' | grep -q music-connect-mysql-1; then
  docker exec -e MYSQL_PWD="$PASS" music-connect-mysql-1 sh -c "mysqldump -u'$USER_' -h127.0.0.1 '$DB'" | gzip > "$OUT"
else
  mysqldump -u"$USER_" -h"$HOST" -P"$PORT" "$DB" | gzip > "$OUT"
fi

echo "[backup] wrote $OUT ($(du -h "$OUT" | cut -f1))"

# retention: drop backups older than N days
find "$BACKUP_DIR" -name "$DB-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete
echo "[backup] retention: keeping the last $RETENTION_DAYS days"
