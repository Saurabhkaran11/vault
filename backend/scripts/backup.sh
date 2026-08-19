#!/usr/bin/env bash
# Vault database backup.
#
# Takes a compressed custom-format dump (pg_dump -Fc), which is what
# pg_restore needs for selective/parallel restores, and uploads it to S3 with
# a date-stamped key. Designed to be run from cron or a scheduled task.
#
# A backup you have never restored is a hypothesis, not a backup — see
# restore-check.sh, which proves the dump actually loads.
#
# Required: DATABASE_URL (libpq form, not SQLAlchemy's +asyncpg form)
# Optional: BACKUP_BUCKET, BACKUP_PREFIX, RETAIN_DAYS
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL (postgresql://user:pass@host:port/db)}"
BACKUP_PREFIX="${BACKUP_PREFIX:-vault-backups}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="/tmp/vault-${STAMP}.dump"

# SQLAlchemy URLs carry a driver suffix that libpq does not understand.
PG_URL="${DATABASE_URL/+asyncpg/}"
PG_URL="${PG_URL/+psycopg2/}"

# pg_dump refuses to dump a server newer than itself, and a version skew is
# the classic way a backup job silently stops working after a database
# upgrade. Fail with the fix rather than a bare error.
SERVER_MAJOR=$(psql "${PG_URL}" -tAc "SHOW server_version" 2>/dev/null | cut -d. -f1 || echo "")
CLIENT_MAJOR=$(pg_dump --version | grep -oE '[0-9]+' | head -1)
if [ -n "${SERVER_MAJOR}" ] && [ "${CLIENT_MAJOR}" -lt "${SERVER_MAJOR}" ]; then
  echo "✗ pg_dump ${CLIENT_MAJOR} cannot dump a PostgreSQL ${SERVER_MAJOR} server." >&2
  echo "  Run this script from a container with the matching client, e.g.:" >&2
  echo "    docker run --rm -e DATABASE_URL -v \$PWD:/w -w /w postgres:${SERVER_MAJOR} bash scripts/backup.sh" >&2
  exit 1
fi

echo "→ dumping to ${OUT} (client ${CLIENT_MAJOR}, server ${SERVER_MAJOR:-unknown})"
pg_dump --format=custom --compress=9 --no-owner --no-privileges \
        --file="${OUT}" "${PG_URL}"

SIZE=$(du -h "${OUT}" | cut -f1)
echo "→ dump complete (${SIZE})"

# Refuse to ship an implausibly small dump: a truncated or failed dump that
# still exits 0 would otherwise silently replace good backups.
BYTES=$(wc -c < "${OUT}")
if [ "${BYTES}" -lt 4096 ]; then
  echo "✗ dump is only ${BYTES} bytes — refusing to upload a probably-empty backup" >&2
  exit 1
fi

if [ -n "${BACKUP_BUCKET:-}" ]; then
  KEY="${BACKUP_PREFIX}/${STAMP}.dump"
  echo "→ uploading s3://${BACKUP_BUCKET}/${KEY}"
  aws s3 cp "${OUT}" "s3://${BACKUP_BUCKET}/${KEY}"

  # Retention. S3 lifecycle rules are the more reliable place for this — they
  # keep working when this script does not run — so treat it as a backstop.
  CUTOFF=$(date -u -d "${RETAIN_DAYS} days ago" +%Y-%m-%d 2>/dev/null \
           || date -u -v-"${RETAIN_DAYS}"d +%Y-%m-%d)
  aws s3 ls "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/" | while read -r _ _ _ name; do
    stamp="${name%%T*}"
    if [[ -n "${stamp}" && "${stamp}" < "${CUTOFF}" ]]; then
      echo "  · pruning ${name} (older than ${RETAIN_DAYS}d)"
      aws s3 rm "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX}/${name}"
    fi
  done
  rm -f "${OUT}"
else
  echo "→ BACKUP_BUCKET unset; dump left at ${OUT}"
fi

echo "✓ backup ${STAMP} done"
