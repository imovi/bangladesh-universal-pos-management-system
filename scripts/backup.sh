#!/usr/bin/env bash
# scripts/backup.sh — Production PostgreSQL backup script for Universal POS
# Scheduled via cron (02:30 Asia/Dhaka) and invoked via npm run backup:now

set -euo pipefail

POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-pos_admin}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-pos_secret}"
POSTGRES_DB="${POSTGRES_DB:-universal_pos}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/universal-pos}"
BACKUP_AGE_PUBLIC_KEY="${BACKUP_AGE_PUBLIC_KEY:-}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"

DAILY_DIR="${BACKUP_DIR}/daily"
WEEKLY_DIR="${BACKUP_DIR}/weekly"
mkdir -p "${DAILY_DIR}" "${WEEKLY_DIR}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DUMP_FILE="${DAILY_DIR}/backup_${POSTGRES_DB}_${TIMESTAMP}.dump"
GLOBALS_FILE="${DAILY_DIR}/globals_${TIMESTAMP}.sql"
METADATA_FILE="${BACKUP_DIR}/last-backup.json"

echo "[BACKUP] Starting backup for database '${POSTGRES_DB}' on ${POSTGRES_HOST}:${POSTGRES_PORT} at $(date -Iseconds)..."

export PGPASSWORD="${POSTGRES_PASSWORD}"

# 1. Dump globals (roles and server-level grants)
pg_dumpall -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" --globals-only > "${GLOBALS_FILE}" || true

# 2. Dump database in custom format (-Fc)
pg_dump -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --format=custom --file="${DUMP_FILE}"

FINAL_FILE="${DUMP_FILE}"
IS_ENCRYPTED=false

# 3. Encrypt with age if public key provided
if [[ -n "${BACKUP_AGE_PUBLIC_KEY}" ]] && command -v age >/dev/null 2>&1; then
    ENCRYPTED_FILE="${DUMP_FILE}.age"
    age -r "${BACKUP_AGE_PUBLIC_KEY}" -o "${ENCRYPTED_FILE}" "${DUMP_FILE}"
    rm -f "${DUMP_FILE}"
    FINAL_FILE="${ENCRYPTED_FILE}"
    IS_ENCRYPTED=true
    echo "[BACKUP] Backup successfully encrypted with age."
else
    if [[ -n "${BACKUP_AGE_PUBLIC_KEY}" ]]; then
        echo "[WARNING] age CLI not found; saving unencrypted backup." >&2
    fi
fi

# 4. Checksum
sha256sum "${FINAL_FILE}" > "${FINAL_FILE}.sha256"
SIZE_BYTES=$(stat -c%s "${FINAL_FILE}" 2>/dev/null || stat -f%z "${FINAL_FILE}" 2>/dev/null || wc -c < "${FINAL_FILE}")
CHECKSUM=$(awk '{print $1}' "${FINAL_FILE}.sha256")

# 5. Weekly retention copy on Sunday (0)
DAY_OF_WEEK=$(date +%w)
if [[ "${DAY_OF_WEEK}" -eq 0 ]]; then
    cp "${FINAL_FILE}" "${WEEKLY_DIR}/"
    cp "${FINAL_FILE}.sha256" "${WEEKLY_DIR}/" || true
fi

# 6. Prune old backups (14 daily, 8 weekly)
ls -1t "${DAILY_DIR}"/backup_*.* 2>/dev/null | grep -E '\.(dump|age)$' | tail -n +15 | xargs -r -I {} rm -f "{}" "{}.sha256"
ls -1t "${WEEKLY_DIR}"/backup_*.* 2>/dev/null | grep -E '\.(dump|age)$' | tail -n +9 | xargs -r -I {} rm -f "{}" "{}.sha256"

# 7. Off-server copy with rclone
OFF_SERVER_CONFIGURED=false
OFF_SERVER_WARNING="ব্যাকআপ শুধু এই সার্ভারে আছে"

if [[ -n "${BACKUP_RCLONE_REMOTE}" ]]; then
    if command -v rclone >/dev/null 2>&1; then
        rclone copy "${FINAL_FILE}" "${BACKUP_RCLONE_REMOTE}"
        OFF_SERVER_CONFIGURED=true
        OFF_SERVER_WARNING=""
        echo "[BACKUP] Successfully copied backup to remote '${BACKUP_RCLONE_REMOTE}'."
    else
        echo "[WARNING] rclone not installed! ${OFF_SERVER_WARNING}" >&2
    fi
else
    echo "[WARNING] BACKUP_RCLONE_REMOTE is not set! ${OFF_SERVER_WARNING}" >&2
fi

# 8. Record last-backup.json
cat <<EOF > "${METADATA_FILE}"
{
  "timestamp": "$(date -Iseconds)",
  "filename": "$(basename "${FINAL_FILE}")",
  "filePath": "${FINAL_FILE}",
  "sizeBytes": ${SIZE_BYTES},
  "encrypted": ${IS_ENCRYPTED},
  "offServerConfigured": ${OFF_SERVER_CONFIGURED},
  "offServerWarning": $(if [[ "${OFF_SERVER_CONFIGURED}" == "true" ]]; then echo "null"; else echo "\"${OFF_SERVER_WARNING}\""; fi),
  "checksum": "${CHECKSUM}"
}
EOF

echo "[BACKUP] Backup completed successfully: $(basename "${FINAL_FILE}") (${SIZE_BYTES} bytes)."
