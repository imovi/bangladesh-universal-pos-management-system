# Universal POS Automated Backup Service

Automated PostgreSQL backup daemon running in Docker alongside production containers.

## Architecture

- **Base Image:** `postgres:17-alpine`
- **Pinned Utilities:** `age=1.3.2-r1`, `rclone=1.75.2-r0`, `bash`, `tzdata`
- **Schedule:** Nightly at **02:30 Asia/Dhaka** (`TZ=Asia/Dhaka`) via BusyBox `crond` logging directly to stdout.
- **First Run:** Automatically triggers an initial backup immediately on container startup so fresh deployments have a valid backup on Day 1.
- **Fail-Safe Encryption:** If `BACKUP_AGE_PUBLIC_KEY` is set, `age` encryption is mandatory. If `age` is missing or fails, the plain dump is immediately deleted, no file is uploaded, and `last-backup.json` records `ok: false` with Bangla explanation: `age অনুপস্থিত অথবা এনক্রিপশন ব্যর্থ হয়েছে`. If no key is configured, the backup remains local and unencrypted, and `rclone` refuses off-server upload.
- **Retention:** 14 daily backups and 8 weekly backups (Sunday snapshots).
- **Volume:** Stores dumps and `last-backup.json` metadata in the shared Docker named volume `backups`, mounted read-only by the `api` container for `/settings` Backups status card and daily health check alerts.

## Checking Backup Operations

1. **View Container Execution Logs:**
   ```bash
   docker compose -f deploy/docker-compose.prod.yml logs backup
   ```
2. **Inspect Backups in Admin UI:**
   Navigate to `/settings` as Owner and view the **Backups** card.
3. **Verify Status File:**
   ```bash
   docker compose -f deploy/docker-compose.prod.yml exec backup cat /backups/last-backup.json
   ```
