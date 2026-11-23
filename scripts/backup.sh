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
AGE_BIN="${AGE_BIN:-age}"

DAILY_DIR="${BACKUP_DIR}/daily"
WEEKLY_DIR="${BACKUP_DIR}/weekly"
mkdir -p "${DAILY_DIR}" "${WEEKLY_DIR}"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DUMP_FILE="${DAILY_DIR}/backup_${POSTGRES_DB}_${TIMESTAMP}.dump"
GLOBALS_FILE="${DAILY_DIR}/globals_${TIMESTAMP}.sql"
METADATA_FILE="${BACKUP_DIR}/last-backup.json"

write_failure_status() {
    local reason="$1"
    mkdir -p "${BACKUP_DIR}"
    cat <<EOF > "${METADATA_FILE}"
{
  "ok": false,
  "timestamp": "$(date -Iseconds)",
  "filename": null,
  "filePath": null,
  "sizeBytes": null,
  "encrypted": false,
  "offServerConfigured": false,
  "offServerWarning": null,
  "reason": "${reason}",
  "error": "${reason}"
}
EOF
}

echo "[BACKUP] Starting backup for database '${POSTGRES_DB}' on ${POSTGRES_HOST}:${POSTGRES_PORT} at $(date -Iseconds)..."

export PGPASSWORD="${POSTGRES_PASSWORD}"

# 1. Dump globals (roles and server-level grants). Must NOT fail!
if ! pg_dumpall -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" --globals-only > "${GLOBALS_FILE}"; then
    echo "[BACKUP ERROR] pg_dumpall globals dump failed!" >&2
    rm -f "${GLOBALS_FILE}"
    write_failure_status "pg_dumpall globals dump failed"
    exit 1
fi

# 2. Dump database in custom format (-Fc)
if ! pg_dump -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --format=custom > "${DUMP_FILE}"; then
    echo "[BACKUP ERROR] pg_dump database dump failed!" >&2
    rm -f "${DUMP_FILE}" "${GLOBALS_FILE}"
    write_failure_status "pg_dump database dump failed"
    exit 1
fi

FINAL_FILE="${DUMP_FILE}"
IS_ENCRYPTED=false
WARNING_MSG=""
OFF_SERVER_CONFIGURED=false
OFF_SERVER_WARNING="ব্যাকআপ শুধু এই সার্ভারে আছে"

# 3. Encrypt with age if public key provided; fail-safe: never fail open
if [[ -n "${BACKUP_AGE_PUBLIC_KEY}" ]]; then
    ENCRYPTED_FILE="${DUMP_FILE}.age"
    if ! command -v "${AGE_BIN}" >/dev/null 2>&1; then
        echo "[BACKUP ERROR] age CLI not found; encryption required but impossible!" >&2
        rm -f "${DUMP_FILE}" "${GLOBALS_FILE}" "${ENCRYPTED_FILE}"
        write_failure_status "age অনুপস্থিত অথবা এনক্রিপশন ব্যর্থ হয়েছে"
        exit 1
    fi

    if ! "${AGE_BIN}" -r "${BACKUP_AGE_PUBLIC_KEY}" -o "${ENCRYPTED_FILE}" "${DUMP_FILE}"; then
        echo "[BACKUP ERROR] age encryption failed!" >&2
        rm -f "${DUMP_FILE}" "${GLOBALS_FILE}" "${ENCRYPTED_FILE}"
        write_failure_status "age অনুপস্থিত অথবা এনক্রিপশন ব্যর্থ হয়েছে"
        exit 1
    fi

    rm -f "${DUMP_FILE}"
    FINAL_FILE="${ENCRYPTED_FILE}"
    IS_ENCRYPTED=true
    echo "[BACKUP] Backup successfully encrypted with age."
else
    # BACKUP_AGE_PUBLIC_KEY is not set:
    # Stored unencrypted on the server.
    # rclone MUST REFUSE to upload an unencrypted file.
    IS_ENCRYPTED=false
    WARNING_MSG="ব্যাকআপ এনক্রিপ্ট করা নেই, তাই সার্ভারের বাইরে পাঠানো হয়নি"
    OFF_SERVER_WARNING="ব্যাকআপ এনক্রিপ্ট করা নেই, তাই সার্ভারের বাইরে পাঠানো হয়নি"
    OFF_SERVER_CONFIGURED=false
    echo "[BACKUP WARNING] ${WARNING_MSG}" >&2
fi

# 4. Checksum
if ! sha256sum "${FINAL_FILE}" > "${FINAL_FILE}.sha256"; then
    echo "[BACKUP ERROR] sha256sum generation failed!" >&2
    rm -f "${FINAL_FILE}" "${GLOBALS_FILE}"
    write_failure_status "sha256sum generation failed"
    exit 1
fi

SIZE_BYTES=$(stat -c%s "${FINAL_FILE}" 2>/dev/null || stat -f%z "${FINAL_FILE}" 2>/dev/null || wc -c < "${FINAL_FILE}")
CHECKSUM=$(awk '{print $1}' "${FINAL_FILE}.sha256")

# 5. Weekly retention copy on Sunday (0)
DAY_OF_WEEK=$(date +%w)
if [[ "${DAY_OF_WEEK}" -eq 0 ]]; then
    cp "${FINAL_FILE}" "${WEEKLY_DIR}/"
    cp "${FINAL_FILE}.sha256" "${WEEKLY_DIR}/" || true
fi

# 6. Prune old backups (14 daily, 8 weekly)
# List newest first, prune 15th+ daily and 9th+ weekly
ls -1t "${DAILY_DIR}"/backup_*.* 2>/dev/null | grep -E '\.(dump|age)$' | tail -n +15 | while read -r f; do
    rm -f "$f" "$f.sha256"
done || true

ls -1t "${WEEKLY_DIR}"/backup_*.* 2>/dev/null | grep -E '\.(dump|age)$' | tail -n +9 | while read -r f; do
    rm -f "$f" "$f.sha256"
done || true

# 7. Off-server copy with rclone
if [[ "${IS_ENCRYPTED}" == "true" ]]; then
    if [[ -n "${BACKUP_RCLONE_REMOTE}" ]]; then
        if ! command -v rclone >/dev/null 2>&1; then
            echo "[BACKUP ERROR] rclone not installed!" >&2
            write_failure_status "rclone not installed"
            exit 1
        fi
        if ! rclone copy "${FINAL_FILE}" "${BACKUP_RCLONE_REMOTE}"; then
            echo "[BACKUP ERROR] rclone copy to ${BACKUP_RCLONE_REMOTE} failed!" >&2
            write_failure_status "rclone upload failed"
            exit 1
        fi
        OFF_SERVER_CONFIGURED=true
        OFF_SERVER_WARNING=""
        echo "[BACKUP] Successfully copied backup to remote '${BACKUP_RCLONE_REMOTE}'."
    else
        echo "[WARNING] BACKUP_RCLONE_REMOTE is not set! ${OFF_SERVER_WARNING}" >&2
    fi
else
    # IS_ENCRYPTED is false.
    # rclone must refuse to upload an unencrypted file.
    if [[ -n "${BACKUP_RCLONE_REMOTE}" ]]; then
        echo "[BACKUP WARNING] rclone refuses to upload unencrypted backup: ${OFF_SERVER_WARNING}" >&2
    fi
fi

# 8. Record last-backup.json
cat <<EOF > "${METADATA_FILE}"
{
  "ok": true,
  "timestamp": "$(date -Iseconds)",
  "filename": "$(basename "${FINAL_FILE}")",
  "filePath": "${FINAL_FILE}",
  "sizeBytes": ${SIZE_BYTES},
  "encrypted": ${IS_ENCRYPTED},
  "offServerConfigured": ${OFF_SERVER_CONFIGURED},
  "offServerWarning": $(if [[ -n "${OFF_SERVER_WARNING}" ]]; then echo "\"${OFF_SERVER_WARNING}\""; else echo "null"; fi),
  "warning": $(if [[ -n "${WARNING_MSG}" ]]; then echo "\"${WARNING_MSG}\""; else echo "null"; fi),
  "checksum": "${CHECKSUM}"
}
EOF

echo "[BACKUP] Backup completed successfully: $(basename "${FINAL_FILE}") (${SIZE_BYTES} bytes)."
