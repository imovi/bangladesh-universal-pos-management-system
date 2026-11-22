# Universal POS — Production Deployment Guide

A step-by-step deployment guide for business owners and operators to launch Universal POS on a live Ubuntu 24.04 server with automatic SSL and zero-downtime architecture.

---

## 1. Prerequisites & Server Selection

For optimal latency and responsiveness across Bangladesh (Dhaka, Chittagong, Sylhet, Rajshahi), choose a cloud VPS provider with data centers in **Singapore** or **Mumbai**:

- **Recommended Providers:** DigitalOcean, Hetzner, Linode, AWS Lightsail, or Vultr.
- **Minimum Server Specifications:**
  - **CPU:** 2 vCPU
  - **RAM:** 4 GB RAM (minimum recommended for Next.js build and PostgreSQL buffers)
  - **Storage:** 40 GB NVMe / SSD
  - **OS:** Ubuntu 24.04 LTS (x64)

---

## 2. Domain & DNS Configuration

1. Purchase a domain name (e.g. `artisanfashion.com` or `pos.yourbrand.com`).
2. Add an **A Record** in your domain registrar's DNS management panel:
   - **Type:** `A`
   - **Host / Name:** `pos` (or `@` for root domain)
   - **Value / Destination:** `YOUR_SERVER_IP` (e.g. `103.20.14.50`)
   - **TTL:** 300 seconds (5 minutes)

---

## 3. Server Preparation & Docker Installation

SSH into your fresh Ubuntu 24.04 server as `root` or a `sudo` user:

```bash
# 1. Update system packages
sudo apt update && sudo apt upgrade -y

# 2. Install essential utilities and Docker official dependencies
sudo apt install -y ca-certificates curl gnupg lsb-release

# 3. Add Docker official GPG key and repository
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 4. Install Docker Engine and Docker Compose
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 5. Verify Docker installation
sudo docker --version
sudo docker compose version
```

---

## 4. Copying Files to the Server

Create a deployment directory and clone or transfer the repository:

```bash
# Create directory
mkdir -p /opt/universal-pos
cd /opt/universal-pos

# Clone repository
git clone https://github.com/imovi/bangladesh-universal-pos-management-system.git .
```

---

## 5. Generating Production Secrets

Run the built-in secret generator to generate cryptographically random keys. This script outputs only to your terminal and never writes keys to disk:

```bash
# Run secret generator using node (Node.js 20+ or via Docker)
docker run --rm -v "$PWD":/app -w /app node:24-bookworm-slim node scripts/gen-secrets.cjs
```

Example output:
```text
POSTGRES_PASSWORD=6wgblmpm2_KGKIfe4KFsCaUuKLborTV5
POSTGRES_RUNTIME_PASSWORD=Z2v-6jH4OOpsd2Drc0HdL7hKUKkOCU3O
JWT_ACCESS_SECRET=f7ca3cda6d6f435082801dc4f074bf7917355fbeeb7cd46466c7956759873923
JWT_REFRESH_SECRET=1a7bb136d4837d7c55a115e30d1d2afee38e7a7a8ef8e545066c65284977d842
```

Now copy the production environment template and paste your generated secrets:

```bash
cp deploy/.env.production.example deploy/.env.production
nano deploy/.env.production
```

In `deploy/.env.production`:
1. Set `DOMAIN=pos.yourbrand.com` (your exact domain).
2. Paste `POSTGRES_PASSWORD`, `POSTGRES_RUNTIME_PASSWORD`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`.
3. Save with `Ctrl+O` and exit with `Ctrl+X`.

---

## 6. Starting the Production System

Start the entire system with Docker Compose:

```bash
cd /opt/universal-pos/deploy

# Build and start all services in detached mode
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### What Happens Automatically:
1. **`postgres`** initializes the database and creates the restricted `pos_runtime` role.
2. **`redis`** boots internal cache and throttler.
3. **`migrate`** deploys all Prisma database migrations as owner and exits cleanly.
4. **`api`** starts the NestJS API server on Node 24 slim under the non-root user `node`.
5. **`admin`** starts the standalone Next.js dashboard on Node 24 slim under non-root `node`.
6. **`caddy`** obtains an automatic Let's Encrypt TLS certificate for your domain and configures reverse proxying.

Check container statuses:
```bash
docker compose -f docker-compose.prod.yml ps
```

---

## 7. Creating the First Owner Account

Once the containers are healthy, open your web browser and navigate to:
```text
https://pos.yourbrand.com/signup
```

Fill in:
- **কোম্পানির নাম (Company Name):** e.g. `Artisan Apparel Ltd`
- **ইউআরএল স্লাগ (Slug):** e.g. `artisan`
- **মালিকের তথ্য (Owner Details):** Full Name, Phone (+88017...), Email, Strong Password.
- **প্রথম শাখা (Initial Branch):** e.g. `Gulshan Flagship Store` (Code: `GFS-01`).

Click **নিবন্ধন সম্পন্ন করুন (Complete Registration)**. You will be redirected immediately to the dashboard.

---

## 8. Verifying System Health

Run the automated production smoke test directly against your deployed environment:

```bash
API_URL=https://pos.yourbrand.com/api/v1 node scripts/smoke-prod.mjs
```

All 7 verification steps should complete green:
```text
=== Starting Production Smoke Test against https://pos.yourbrand.com/api/v1 ===
[1/7] Signing up tenant 'smoke-...'...
[2/7] Logging in...
[3/7] Creating product with 2 variants...
[4/7] Opening shift...
[5/7] Making cash sale...
[6/7] Fetching receipt...
[7/7] Closing shift...

=== [SUCCESS] All 7 production smoke test steps completed successfully! ===
```

---

## 9. Updating to a New Version & Rollback

### Updating:
```bash
cd /opt/universal-pos

# 1. Pull latest code
git pull origin main

# 2. Rebuild and restart services
cd deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### Rolling Back:
If an issue occurs after an update, rollback to the previous commit:
```bash
cd /opt/universal-pos

# Revert to known stable commit hash
git checkout <PREVIOUS_COMMIT_HASH>

# Rebuild containers
cd deploy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```
