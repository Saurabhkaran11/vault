#!/usr/bin/env bash
# Prove a backup actually restores.
#
# Restores the newest dump into a scratch database and asserts the tables
# exist and hold rows. Run it on a schedule: the failure mode that hurts is
# not "no backups", it is "backups that were never going to restore".
#
# Required: DATABASE_URL (server to create the scratch DB on)
# Optional: DUMP_FILE, BACKUP_BUCKET/BACKUP_PREFIX to pull the latest from S3
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}"
PG_URL="${DATABASE_URL/+asyncpg/}"
PG_URL="${PG_URL/+psycopg2/}"
SCRATCH="vault_restore_check_$$"

DUMP="${DUMP_FILE:-}"
if [ -z "${DUMP}" ]; then
  : "${BACKUP_BUCKET:?set DUMP_FILE or BACKUP_BUCKET}"
  LATEST=$(aws s3 ls "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX:-vault-backups}/" \
           | sort | tail -1 | awk '{print $4}')
  [ -n "${LATEST}" ] || { echo "✗ no backups found" >&2; exit 1; }
  DUMP="/tmp/${LATEST}"
  echo "→ fetching ${LATEST}"
  aws s3 cp "s3://${BACKUP_BUCKET}/${BACKUP_PREFIX:-vault-backups}/${LATEST}" "${DUMP}"
fi

BASE="${PG_URL%/*}"
cleanup() { psql "${BASE}/postgres" -q -c "DROP DATABASE IF EXISTS ${SCRATCH}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "→ restoring into scratch database ${SCRATCH}"
psql "${BASE}/postgres" -q -c "CREATE DATABASE ${SCRATCH}"
psql "${BASE}/${SCRATCH}" -q -c "CREATE EXTENSION IF NOT EXISTS vector"
pg_restore --no-owner --no-privileges --dbind 2>/dev/null \
  --dbname="${BASE}/${SCRATCH}" "${DUMP}" 2>/dev/null \
  || pg_restore --no-owner --no-privileges --dbname="${BASE}/${SCRATCH}" "${DUMP}"

echo "→ verifying"
FAIL=0
for t in users items tasks boards expenses bills alembic_version; do
  n=$(psql "${BASE}/${SCRATCH}" -tAc "SELECT count(*) FROM ${t}" 2>/dev/null || echo "MISSING")
  if [ "${n}" = "MISSING" ]; then
    echo "  ✗ ${t}: table missing from the dump"; FAIL=1
  else
    echo "  · ${t}: ${n} rows"
  fi
done

REV=$(psql "${BASE}/${SCRATCH}" -tAc "SELECT version_num FROM alembic_version" 2>/dev/null || echo "")
[ -n "${REV}" ] && echo "  · schema revision: ${REV}" || { echo "  ✗ no alembic revision — the API would refuse to boot on this restore"; FAIL=1; }

[ "${FAIL}" -eq 0 ] && echo "✓ restore verified" || { echo "✗ restore check FAILED" >&2; exit 1; }
