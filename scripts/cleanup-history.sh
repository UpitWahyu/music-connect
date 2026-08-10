#!/usr/bin/env bash
# Music Connect — playback-history retention.
# Deletes rows older than HISTORY_RETENTION_DAYS (default 90).
# Cron (weekly, Sundays 03:10):
#   10 3 * * 0 /root/music-connect/scripts/cleanup-history.sh >> /var/log/music-cleanup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
DAYS="${HISTORY_RETENTION_DAYS:-90}"

[ -f "$ENV_FILE" ] || { echo "[cleanup] .env not found" >&2; exit 1; }

DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2-)"
USER_="$(echo "$DATABASE_URL" | sed -E 's#mysql://([^:]+):.*#\1#')"
PASS="$(echo "$DATABASE_URL" | sed -E 's#mysql://[^:]+:([^@]+)@.*#\1#')"
DB="$(echo "$DATABASE_URL" | sed -E 's#mysql://.*/([^?]+).*#\1#')"

if docker ps --format '{{.Names}}' | grep -q music-connect-mysql-1; then
  DELETED=$(docker exec music-connect-mysql-1 mysql -u"$USER_" -p"$PASS" "$DB" -N -e \
    "DELETE FROM PlaybackHistory WHERE playedAt < NOW() - INTERVAL $DAYS DAY")
else
  echo "[cleanup] mysql container not running — skipped" >&2
  exit 1
fi

echo "[cleanup] removed $DELETED history rows older than $DAYS days"
