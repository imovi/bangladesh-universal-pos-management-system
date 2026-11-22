# Universal POS — Backup & Disaster Recovery Guide

A comprehensive operational guide for database backups, automated encryption, retention scheduling, monthly restore drills, and dead-server disaster recovery.

---

## 1. Overview & Architecture

Universal POS employs a multi-tiered backup architecture designed to prevent data loss even in catastrophic hardware failure:

- **Automated Nightly Backup:** Scheduled every night at **02:30 Asia/Dhaka** via cron or on-demand using `npm run backup:now`.
- **Database Dump:** Uses PostgreSQL `pg_dump --format=custom` (`-Fc`), enabling compressed, high-performance table restoration and blob preservation.
- **Role & Global Grants Dump:** Separate `globals.sql` capture ensuring `pos_app`, `pos_runtime`, and `pos_system` definitions are preserved.
- **Asymmetric Encryption (`age`):** Backups are encrypted with `age` using a public key (`BACKUP_AGE_PUBLIC_KEY`). The decryption key NEVER resides on the live server.
- **Integrity Validation:** SHA-256 checksums (`.sha256`) generated automatically alongside each archive.
- **Retention Schedule:**
  - **Daily:** 14 most recent daily backups.
  - **Weekly:** 8 most recent weekly backups (taken automatically on Sundays).
- **Off-Server Replication:** Integrated `rclone` support (`BACKUP_RCLONE_REMOTE`). If unset, the system emits a loud warning on the Admin Dashboard: **"ব্যাকআপ শুধু এই সার্ভারে আছে"**.

---

## 2. Setting Up Age Encryption

To ensure database dumps cannot be compromised if the server is breached:

1. **Generate an age keypair on your secure local computer** (e.g. MacBook or personal workstation):
   ```bash
   # Install age
   sudo apt install age   # or brew install age

   # Generate a new keypair
   age-keygen -o universal_pos_owner_backup.key
   ```
2. **Output:**
   ```text
   # created: 2026-11-22T21:00:00+06:00
   # public key: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
   AGE-SECRET-KEY-1...
   ```
3. **Store the Secret Key safely:**
   - Store `universal_pos_owner_backup.key` in your encrypted password manager (1Password, Bitwarden, KeePass) or a physical offline USB drive.
   - **NEVER put the private key on the live VPS.**
4. **Configure Public Key on Server:**
   In your `deploy/.env.production`:
   ```bash
   BACKUP_AGE_PUBLIC_KEY="age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
   ```

---

## 3. Off-Server Replication with Rclone

Never keep backups only on the primary server. If the VPS disk corrupts or provider locks the machine, data is lost.

1. **Install and configure rclone on the server:**
   ```bash
   sudo apt install -y rclone
   rclone config
   # Follow prompts to set up AWS S3, Cloudflare R2, Google Drive, or Backblaze B2
   ```
2. **Configure remote name in `.env.production`:**
   ```bash
   BACKUP_RCLONE_REMOTE="my-cloud-storage:universal-pos-backups"
   ```
3. **If not configured:**
   The admin page `/settings` will prominently display:
   > ⚠️ **ব্যাকআপ শুধু এই সার্ভারে আছে** (Backups are stored on this server only)

---

## 4. Running a Manual Backup

Run on-demand anytime before making system changes or updates:

```bash
cd /opt/universal-pos
npm run backup:now
```

Or via direct shell script:
```bash
./scripts/backup.sh
```

Output:
```text
[BACKUP] Starting backup for database 'universal_pos'...
[BACKUP] File successfully encrypted with age.
[BACKUP] Backup completed: backup_universal_pos_20261122_212529.dump.age (0.30 MB)
```

---

## 5. Monthly Restore Drill Procedure

A backup that has never been restored cannot be trusted. Run this drill once a month:

```bash
cd /opt/universal-pos

# Run automated restore drill into an isolated check database
npm run restore:drill
```

Or test a specific backup archive:
```bash
./scripts/restore.sh backups/daily/backup_universal_pos_20261122_212529.dump universal_pos_restore_check
```

### Safety Rules:
- `restore.sh` **NEVER** restores into `universal_pos` (the live database). Attempting to do so triggers an immediate fatal safety exit.
- The drill restores into `universal_pos_restore_check`.
- The drill prints table row counts for:
  - `tenants`
  - `products`
  - `product_variants`
  - `sales`
  - `sale_items`
  - `stock_movements`
  - `loyalty_ledger`
  - `audit_logs`
- If row counts match your expected volume and RLS holds, the drill is verified.
- The completion date is recorded and shown on `/settings` under **Last Restore Drill**.

---

## 6. Disaster Recovery: Dead Server Rebuild

If your production VPS dies or catches fire:

### Step 1: Provision a New VPS
1. Spin up a new Ubuntu 24.04 VPS in Singapore or Mumbai region.
2. Install Docker and clone the repository as described in `docs/go-live/deploy.md`.

### Step 2: Fetch the Latest Backup
Download the latest encrypted backup file from your off-server cloud storage (`rclone copy remote:path /opt/universal-pos/backups/daily/`).

### Step 3: Decrypt with Your Owner Key
Copy your offline `universal_pos_owner_backup.key` temporarily to the operator machine:
```bash
age -d -i universal_pos_owner_backup.key -o latest_backup.dump latest_backup.dump.age
```

### Step 4: Restore Database
```bash
# Restore into fresh universal_pos database
export POSTGRES_DB=universal_pos_temp
./scripts/restore.sh latest_backup.dump universal_pos_recovered

# Verify row counts
docker exec -i universal-pos-prod-postgres-1 psql -U pos_admin -d universal_pos_recovered -c "SELECT count(*) FROM sales;"

# Switch over to live name
docker exec -i universal-pos-prod-postgres-1 psql -U pos_admin -d postgres -c "
  DROP DATABASE IF EXISTS universal_pos;
  ALTER DATABASE universal_pos_recovered RENAME TO universal_pos;
"
```

### Step 5: Start All Services
```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d
```
Verify health:
```bash
curl -k https://localhost/api/v1/health
```
Your store is back online with zero data loss.
