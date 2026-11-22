#!/usr/bin/env bash
# scripts/restore.sh — Isolated PostgreSQL restore drill script for Universal POS
# Usage: ./scripts/restore.sh <backup_file> [target_database]

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <backup_file> [target_database]"
    exit 1
fi

BACKUP_FILE="$1"
TARGET_DB="${2:-universal_pos_restore_check}"

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-pos_admin}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-pos_secret}"
LIVE_DB="${POSTGRES_DB:-universal_pos}"
RUNTIME_USER="${POSTGRES_RUNTIME_USER:-pos_runtime}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/universal-pos}"

# RESTORE SAFETY RULE: NEVER RESTORE DIRECTLY INTO LIVE DATABASE
if [[ "${TARGET_DB}" == "${LIVE_DB}" || "${TARGET_DB}" == "universal_pos" ]]; then
    echo "[FATAL SAFETY ERROR] restore.sh will NEVER restore into live database '${TARGET_DB}'!" >&2
    echo "You must provide a distinct test/target database name (e.g. universal_pos_restore_check)." >&2
    exit 1
fi

if [[ ! -f "${BACKUP_FILE}" ]]; then
    echo "[ERROR] Backup file '${BACKUP_FILE}' does not exist!" >&2
    exit 1
fi

echo "[RESTORE] Starting restore drill from '${BACKUP_FILE}' into target database '${TARGET_DB}'..."

export PGPASSWORD="${POSTGRES_PASSWORD}"

DUMP_TO_RESTORE="${BACKUP_FILE}"
TEMP_DECRYPTED=""

# Decrypt if age encrypted
if [[ "${BACKUP_FILE}" == *.age ]]; then
    KEY_FILE="${BACKUP_AGE_KEY_FILE:-}"
    if [[ -z "${KEY_FILE}" ]]; then
        echo "[ERROR] Encrypted backup detected, but BACKUP_AGE_KEY_FILE is not set." >&2
        exit 1
    fi
    DECRYPTED_PATH="${BACKUP_FILE%.age}"
    age -d -i "${KEY_FILE}" -o "${DECRYPTED_PATH}" "${BACKUP_FILE}"
    DUMP_TO_RESTORE="${DECRYPTED_PATH}"
    TEMP_DECRYPTED="${DECRYPTED_PATH}"
fi

# Clean up temporary decrypted file on exit
trap 'if [[ -n "${TEMP_DECRYPTED}" && -f "${TEMP_DECRYPTED}" ]]; then rm -f "${TEMP_DECRYPTED}"; fi' EXIT

# 1. Drop existing target database if present, and recreate
echo "[RESTORE] Recreating target database '${TARGET_DB}'..."
psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -c "DROP DATABASE IF EXISTS \"${TARGET_DB}\";"
psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -c "CREATE DATABASE \"${TARGET_DB}\" OWNER \"${POSTGRES_USER}\";"

# 2. Restore globals/roles if present
GLOBALS_FILE="$(dirname "${BACKUP_FILE}")/globals.sql"
if [[ -f "${GLOBALS_FILE}" ]]; then
    echo "[RESTORE] Applying global roles..."
    psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d postgres -f "${GLOBALS_FILE}" || true
fi

# 3. Restore custom dump
echo "[RESTORE] Restoring database schema and records..."
pg_restore -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${TARGET_DB}" --no-owner --role="${POSTGRES_USER}" "${DUMP_TO_RESTORE}"

# 4. Re-grant runtime permissions on the restored database
psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${TARGET_DB}" <<EOSQL
    GRANT CONNECT ON DATABASE "${TARGET_DB}" TO "${RUNTIME_USER}";
    GRANT USAGE ON SCHEMA public TO "${RUNTIME_USER}", pos_app, pos_system;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pos_app;
    GRANT SELECT, INSERT ON audit_logs TO pos_app;
    REVOKE UPDATE, DELETE ON audit_logs FROM pos_app;
    GRANT SELECT, INSERT ON loyalty_ledger TO pos_app;
    REVOKE UPDATE, DELETE ON loyalty_ledger FROM pos_app;
EOSQL

# 5. Query and print row counts
echo ""
echo "================ RESTORE ROW COUNT SUMMARY ================"
TABLES=("tenants" "products" "product_variants" "sales" "sale_items" "stock_movements" "loyalty_ledger" "audit_logs")
for t in "${TABLES[@]}"; do
    COUNT=$(psql -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${TARGET_DB}" -t -A -c "SELECT count(*) FROM \"${t}\";" 2>/dev/null || echo "0")
    printf "  %-24s: %s rows\n" "${t}" "${COUNT}"
done
echo "==========================================================="
echo ""

# 6. Record metadata in last-restore-drill.json
mkdir -p "${BACKUP_DIR}"
cat <<EOF > "${BACKUP_DIR}/last-restore-drill.json"
{
  "timestamp": "$(date -Iseconds)",
  "database": "${TARGET_DB}",
  "backupFile": "$(basename "${BACKUP_FILE}")",
  "status": "success"
}
EOF

echo "[RESTORE] Restore drill completed successfully into '${TARGET_DB}'."
