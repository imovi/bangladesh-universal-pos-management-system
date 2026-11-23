#!/usr/bin/env bash
# deploy/backup/entrypoint.sh — Startup and cron entrypoint for backup container

set -euo pipefail

echo "[BACKUP-INIT] Starting backup container at $(date -Iseconds) in TZ=${TZ:-Asia/Dhaka}..."

# Setup rclone config if passed via environment
if [[ -n "${RCLONE_CONFIG_DATA:-}" ]]; then
    mkdir -p /root/.config/rclone
    echo "${RCLONE_CONFIG_DATA}" > /root/.config/rclone/rclone.conf
    chmod 600 /root/.config/rclone/rclone.conf
fi

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:-pos_admin}"
POSTGRES_DB="${POSTGRES_DB:-universal_pos}"

echo "[BACKUP-INIT] Waiting for PostgreSQL database '${POSTGRES_DB}' on ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until pg_isready -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; do
    echo "[BACKUP-INIT] Database not ready yet; sleeping 2 seconds..."
    sleep 2
done
echo "[BACKUP-INIT] PostgreSQL is ready."

# First run: run one backup when the container starts so fresh install has backup on day one
echo "[BACKUP-INIT] Executing initial day-one backup on startup..."
if /usr/local/bin/backup.sh; then
    echo "[BACKUP-INIT] Initial backup completed successfully."
else
    echo "[BACKUP-INIT] Initial backup returned non-zero (tables may be undergoing initial migration)" >&2
fi

# Configure cron schedule (02:30 Asia/Dhaka daily)
mkdir -p /var/spool/cron/crontabs /etc/crontabs
cat <<'EOF' > /var/spool/cron/crontabs/root
30 2 * * * /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1
EOF
cp /var/spool/cron/crontabs/root /etc/crontabs/root

echo "[BACKUP-INIT] Cron job scheduled for 02:30 Asia/Dhaka daily."
echo "[BACKUP-INIT] Starting crond in foreground..."

# Start Busybox crond in foreground, logging to stdout
exec crond -f -l 2 -L /dev/stdout
