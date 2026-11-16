# Overnight Run Report: Universal POS Admin & Backend Hardening

**Date:** 2026-11-16  
**Repository:** `imovi/bangladesh-universal-pos-management-system`  
**Author:** Antigravity Unattended Autonomous Session  

---

## 1. Work List Status Summary

| Item | Description | Status | Commit Hash | CI Result |
|---|---|---|---|---|
| **A0** | Admin Dashboard workspace scaffold (Next.js 15, Tailwind, shadcn, Vitest, Playwright) | **Done** | `4e1a6b6` | Green |
| **Fix 1** | Role max discount: NULL counts as 0, 0..100 NOT NULL constraint, Owner default 100 | **Done** | `3df5b73` | Green |
| **Fix 2** | Combined discount cap (item + bill <= user limit) with integer ceiling calculation | **Done** | `6363813` | Green |
| **Fix 3** | Mandatory sale UUID in body and canonical hash Idempotency-Key validation | **Done** | `8266153` | Green |
| **A1** | API Gap Closure & Hardening (Statement opening balance, Tax default, Categories hierarchy, Search/Filter/Sort) | **Done** | `04932e5` | Green |
| **A2** | Sign-In & App Shell (Bilingual BN/EN, Light/Dark, Role-based Nav, Breadcrumbs, Tenant resolution) | **Done** | `d2af950` | Green |
| **A3** | Catalog & Variants (Multi-option matrix, SKU auto-gen, barcode lookup, bulk pricing) | **Done** | `66fe872` | Green |
| **A4** | Stock & Inventory (Size-colour grid, opening stock, adjustments, low-stock alerts, movement history) | **Done** | `e68641c` | Green (resolved) |
| **A5** | Purchasing (Suppliers, PO lifecycle, Partial GRN receiving, Payments & Statement balance) | **Done** | `101e986` | Green (resolved) |
| **Fix 5** | Per-payment-method totals in shift figures (`paymentMethodTotalsMinor` enum breakdown) | **Done** | `1d371e9` | Green (resolved) |
| **A6** | Sales, Customers, Registers & Shifts (History filters, 58/80mm receipt, shift drawer reconciliation, void modal) | **Done** | `fb6efd3` | Green (resolved) |
| **A7** | Dashboard & Reports (KPIs, Payment method split bar, Top selling, Variant matrix, Stock valuation, P&L statement, CSV export) + CI Fix | **Done** | `e7c6c66` | Green |
| **A8** | Settings & Staff (Shop settings, branches, users, roles with 0..100% discount limit, audit logs) | **Not Started** | *Paused by user* | Pending review |
| **A9** | Finish (Responsive 375px audit, Axe accessibility tests, Admin README) | **Not Started** | *Paused by user* | Pending review |
| **Fix 4** | Narrow `pos_system` SELECT policies | **Not Started** | *Paused by user* | Pending review |

---

## 2. Issues Encountered & Resolution (CI Failure Root Cause)

### CI Failure Cause (A4 through A6)
- **Problem:** GitHub Actions CI passed on A2, but failed at "Run Admin Dashboard E2E tests" on A4, A5, Fix 5, and A6.
- **Root Cause Identified:**
  1. In `apps/api/src/modules/auth/auth.controller.ts`, `@Throttle` enforces `AUTH_THROTTLE_LIMIT` with a default of **5 requests per minute** (`limit: Number(process.env.AUTH_THROTTLE_LIMIT) || 5`).
  2. While local development ran with high throttle limits, the CI workflow environment in `.github/workflows/ci.yml` did not export `AUTH_THROTTLE_LIMIT`, `RATE_LIMIT_LIMIT`, or `REFRESH_THROTTLE_LIMIT`.
  3. Once the E2E test suite exceeded Milestone A2's 4 tests, subsequent tests (`inventory-flow.spec.ts` in A4 onwards) triggered the 5th and subsequent logins, immediately receiving `HTTP 429 Too Many Requests`.
  4. Playwright was configured with `reporter: "html"` only, hiding test run names and error messages from the CI console output.
- **Fix Applied:**
  1. Updated `.github/workflows/ci.yml` to supply `AUTH_THROTTLE_LIMIT=5000`, `RATE_LIMIT_LIMIT=5000`, and `REFRESH_THROTTLE_LIMIT=5000` to the background API process and step environment.
  2. Updated API readiness check from `curl -s http://localhost:4000/api/v1/auth/login` to `curl -sf http://localhost:4000/api/v1/health` (which verifies 200 OK and database connectivity).
  3. Updated `apps/admin/playwright.config.ts` to output `[["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]` under CI so every test name, duration, and error trace is streamed directly to stdout.
  4. Added `actions/upload-artifact@v4` in `ci.yml` uploading `apps/admin/playwright-report/` on any failure.
  5. Handled NestJS global interceptor unwrapping (`json.data || json`) across report pages.
- **Regarding `ci_log.txt`:**
  During commit `b8d5bb3`, an empty scratch file named `ci_log.txt` was unintentionally staged while testing CI scripts and immediately cleaned up in `6c427b4`. No credentials or secret keys were accessed or logged.

### New API Endpoints Added
All reporting views in Milestone A7 were constructed strictly using existing endpoints from `apps/api/src/modules/reports/`:
- `GET /reports/sales-summary?startDate=...&endDate=...&branchId=...`
- `GET /reports/sales-by-variant?startDate=...&endDate=...&branchId=...`
- `GET /reports/sales-by-category?startDate=...&endDate=...&branchId=...`
- `GET /reports/sales-by-brand?startDate=...&endDate=...&branchId=...`
- `GET /reports/sales-by-collection?startDate=...&endDate=...&branchId=...`
- `GET /reports/variant-matrix?productId=...&branchId=...`
- `GET /reports/stock-valuation?branchId=...`
- `GET /reports/profit?startDate=...&endDate=...&branchId=...`
No unauthorized backend endpoints or schema fields were invented.

---

## 3. Dependencies Added & Justification

No unrequested third-party dependencies were added outside the project requirements:
- `next-themes` (v0.4.6): Theme toggle (light/dark mode) persistence across localStorage and HTML classes.
- `@tanstack/react-query` (v5.69.0): Server state caching and deduplication.
- `react-hook-form` (v7.54.2) + `@hookform/resolvers` (v4.1.3): Form validation integrating directly with `@universal-pos/shared` Zod schemas.
- `lucide-react` (v1.16.0): UI icons matching shadcn specifications.

---

## 4. Architectural & Design Decisions Made

1. **Client-Side vs Server Parity on Reports:**
   - Every KPI on the Dashboard and Reports screens displays raw numbers returned by the API; no client-side recalculation is performed that could drift from official backend accounting figures.
   - Proportional visual bars (e.g., Sales Revenue composition, COGS vs Gross Profit, Payment method distribution) use standard CSS percentages and accessible `role="progressbar"` attributes, always paired with exact figures in an accompanying table.
2. **UTF-8 BOM CSV Export Utility (`apps/admin/src/lib/export.ts`):**
   - Prefixes CSV downloads with `\uFEFF` (UTF-8 BOM) so Microsoft Excel opens exported files containing Bangla (`বাংলা`) script and English characters without encoding corruption.
3. **Permission-Gating on Sensitive Views:**
   - The Profit & Loss report (`/reports/profit`) explicitly requires the `report.profit` permission. Cashier and Store Keeper roles attempting direct URL access are shown an accessible "Access Denied" view rather than crashing or leaking figures.
4. **Thermal Receipt Previews:**
   - Sales receipts in `/sales/[id]` render with a 58/80mm style preview and print-specific CSS (`@media print`) so shop staff can trigger prints directly from back office.

---

## 5. Local Running Instructions & Demo Accounts

### Run API Backend
```bash
# Ensure Docker containers (PostgreSQL 5432, Redis 6379) are running
docker compose up -d

# Start NestJS API daemon on port 4000
npm --workspace=@universal-pos/api run start:dev
# Or run compiled dist:
PORT=4000 RATE_LIMIT_LIMIT=5000 AUTH_THROTTLE_LIMIT=5000 node apps/api/dist/main.js
```

### Run Admin Dashboard
```bash
# In another terminal:
npm --workspace=@universal-pos/admin run dev
# Or compiled production start:
npm --workspace=@universal-pos/admin run build
npx --workspace=@universal-pos/admin next start -p 3000
```
Open browser at: `http://localhost:3000`

### Demo Login Accounts (Seeded via `npm run seed:demo`)
- **Shop Code (Slug):** `artisan-apparel`
- **Owner Account:**
  - Email: `owner@artisan.com`
  - Password: `Password123!`
  - Permissions: Full administrative access (Catalog, Inventory, Purchasing, Sales, Profit Reports, Settings)
- **Cashier Account:**
  - Email: `cashier@artisan.com`
  - Password: `Password123!`
  - Permissions: Counter sales and shifts (no profit report, cannot void sales without supervisor)
- **Store Keeper Account:**
  - Email: `keeper@artisan.com`
  - Password: `Password123!`
  - Permissions: Inventory adjustments, opening stock, and purchase receiving

---

## 6. GitHub Actions CI Status & Repository Links

- **Repository:** https://github.com/imovi/bangladesh-universal-pos-management-system
- **GitHub Actions Workflows:** https://github.com/imovi/bangladesh-universal-pos-management-system/actions
- **Latest Commit:** `e7c6c66` (`feat(admin): implement milestone a7 dashboard, reports and resolve ci rate limits`)

---

## 7. Screenshots Gallery (`docs/screenshots/`)

High-resolution full-page screenshots captured and committed under `docs/screenshots/`:
- **A2 Shell & Auth:** `docs/screenshots/a2/` (Desktop & Mobile, Light & Dark)
- **A3 Catalog:**
  - `docs/screenshots/a3/desktop-products-list.png`
  - `docs/screenshots/a3/desktop-new-product-form.png`
  - `docs/screenshots/a3/desktop-categories-brands.png`
- **A4 Inventory:**
  - `docs/screenshots/a4/desktop-stock-levels.png`
  - `docs/screenshots/a4/desktop-opening-stock.png`
  - `docs/screenshots/a4/desktop-low-stock.png`
  - `docs/screenshots/a4/desktop-adjustments.png`
- **A5 Purchasing:**
  - `docs/screenshots/a5/desktop-suppliers.png`
  - `docs/screenshots/a5/desktop-purchase-orders.png`
  - `docs/screenshots/a5/desktop-goods-receipts.png`
- **A6 Sales & Shifts:**
  - `docs/screenshots/a6/desktop-sales-list.png`
  - `docs/screenshots/a6/desktop-shifts.png`
  - `docs/screenshots/a6/desktop-registers.png`
  - `docs/screenshots/a6/desktop-customers.png`
- **A7 Dashboard & Reports:**
  - `docs/screenshots/a7/desktop-dashboard.png`
  - `docs/screenshots/a7/desktop-sales-report.png`
  - `docs/screenshots/a7/desktop-stock-valuation.png`
  - `docs/screenshots/a7/desktop-profit-report.png`

---

## 8. Verification & Port Status

- **Unit Tests:** All 17 unit tests in `apps/admin` passed (`npm run test`).
- **E2E Tests:** All 14 tests in Chromium passed (`npm run test:e2e -- --project=chromium`).
- **Static Analysis:** `oxlint --deny-warnings` returned 0 warnings and 0 errors across 62 files.
- **Port Status:** Ports **3000** and **4000** are completely stopped and verified free.
- **Next Work (Paused for Review):** Milestone A8 (Settings & Staff), Milestone A9 (Audit & Axe), and Backend Fix 4 (Narrow `pos_system` policies).
