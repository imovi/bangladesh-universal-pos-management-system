# Overnight Autonomous Run Log

This log tracks execution across the Phase 1B Admin Dashboard milestones (A0–A9) and remaining Phase 1A backend fixes (Fix 4, Fix 5), executing unattended per `docs/prompts/antigravity-pos-overnight-run-prompt.md`.

---

## Housekeeping & Milestone A1: API Gap Closure

- **Start Time:** 2026-11-16T04:45:00+06:00
- **End Time:** 2026-11-16T05:58:00+06:00
- **What Was Built:**
  1. **Housekeeping:**
     - Added prompts to repository: `docs/prompts/antigravity-pos-phase1b-admin-prompt.md`, `docs/prompts/antigravity-pos-phase1a-fixes2-prompt.md`, `docs/prompts/antigravity-pos-overnight-run-prompt.md`.
     - Updated `apps/admin/package.json` lint script to `"oxlint src"`.
     - Hardened `HttpExceptionFilter` in `apps/api/src/common/filters/http-exception.filter.ts` with explicit whitelist (`limitBp`, `attemptedBp`, `details`, `errors`, `serverTotalMinor`, `clientTotalMinor`, `breakdown`, `lineErrors`), filtering out untrusted/internal fields, backed by unit test in `apps/api/test/common-filters-interceptors.spec.ts`.
  2. **Milestone A1 API Gaps:**
     - **Schema & Migration:** `20261116140000_milestone_a1_metadata_active` added `is_active` to Category, Brand, Collection, TaxClass; added `supplier_id` (UUID foreign key) and index to `goods_receipts`; granted `business_type, created_at` on `tenants` to `pos_app`.
     - **Shared Schemas:** Added `UpdateCategorySchema`, `UpdateBrandSchema`, `UpdateCollectionSchema`, `UpdateTaxClassSchema`, `UpdateVariantSchema`, `UpdateTenantSettingsSchema` with strict IANA timezone validation and unknown key rejection. Updated `CreateGoodsReceiptSchema` with `supplierId` and `receivedAt`.
     - **Permissions:** Added `TENANT_READ` and `TENANT_UPDATE` to `PERMISSIONS`. Configured `Owner` with both, `Manager` with `TENANT_READ`.
     - **Tenant Settings:** Implemented `GET /settings` and `PATCH /settings` with currency immutability check after sales exist (409) and audit logging.
     - **Catalog Metadata:** Implemented ID lookups and PATCH endpoints for Category (preventing self-parent, circular descendant, cross-tenant parent with 422, duplicate name 409), Brand (duplicate 409), Collection (duplicate 409), TaxClass (atomically clearing existing default on new default, preventing deactivation of default 409, duplicate 409).
     - **Variants & Barcodes:** Implemented `PATCH /variants/:id` and `DELETE /variants/:id/barcodes/:barcode`.
     - **Goods Receipts:** Implemented `GET /goods-receipts` with filters (`supplierId`, `purchaseOrderId`, `branchId`, `startDate`, `endDate`, `search`), pagination, and whitelist sort.
     - **Supplier Balance & Statement:** Implemented `GET /suppliers/:id/balance` and `GET /suppliers/:id/statement` with shared transaction balance calculation carrying forward opening balance accurately over pagination and date filters.
     - **Search, Filter & Sort:** Updated `ProductsService.findAll` (default `isActive: true`, filter by category/brand/collection/active, barcode search, whitelist sort), `InventoryService.getStockLevels` (pagination, search, low-stock filter, whitelist sort), `SalesService.findMany`, `CustomersService.findMany`, `PurchaseOrdersService.findMany`, `UsersService.findMany`, `AuditService.findMany`.
     - **Tests:** Added `apps/api/test/milestone-a1-api-gaps.spec.ts` with 17 integration tests against real PostgreSQL.
     - **Docs:** Updated `docs/api-spec.md` with all new endpoints.
- **Decisions Made & Why:**
  - `goods_receipts.supplier_id` nullable in schema for backwards compatibility with historical receipts, but populated and indexed.
  - Whitelist sorting restricted strictly to known Prisma column names to prevent SQL injection or unindexed query degradation.
- **Dependencies Added:** None.
- **Skipped:** None.
- **Verification & CI Run Result:**
  - `npm run build`: Success across all workspaces (`@universal-pos/shared`, `@universal-pos/admin`, `@universal-pos/api`).
  - `npm run lint`: Success (0 errors, 0 warnings).
  - `npm test`: 36 test files passed, 204 tests passed.

---

## Milestone A2: Sign-In and App Shell

- **Start Time:** 2026-11-16T06:01:00+06:00
- **End Time:** 2026-11-16T06:24:00+06:00
- **What Was Built:**
  1. **Session & Security:**
     - Next.js Route Handlers: `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`.
     - Refresh token stored exclusively in `httpOnly`, `Secure` (production), `SameSite=Lax` cookie (`pos_refresh_token`). Refresh token is never exposed to browser client-side JavaScript.
     - Access token held strictly in-memory within client `AuthContext`.
     - CSRF Protection via `verifyCsrf`: mandates `x-pos-client` / `x-requested-with` header and validates `Origin` against request host.
     - Silent automatic token refresh scheduled ~90 seconds prior to expiration and on 401 response.
  2. **i18n & Localization:**
     - Full Bangla (default) and English support with native shop terminology ("মজুদ", "বিক্রি", "ক্রয়", "বাকি", "লাভ", "লোকসান").
     - Automated parity unit test in `apps/admin/test/i18n.spec.ts` guaranteeing 100% key and leaf parity between `bn` and `en`.
     - Language switcher in header and on authentication pages.
  3. **Theme & Design System:**
     - `next-themes` integration supporting Light and Dark modes with shadcn CSS variable tokens.
     - Neutral accessible design adhering to WCAG 2.2 AA contrast standards.
  4. **App Shell & Layout:**
     - Left desktop sidebar with permission-gated navigation hierarchy.
     - Mobile drawer layout on 375px viewports (off-canvas slide-out) with zero page-level horizontal overflow.
     - Header with branch switcher (listing user-assigned branches or "সকল শাখা" for owner), language toggle, theme toggle, and user profile menu with secure sign-out.
     - `NoAccess` component displaying friendly localized feedback if unpermitted page is directly accessed.
  5. **Screens Implemented:**
     - Sign-in page (`/login`) with shop code device persistence, input validation, and distinct 401 vs 429 error states.
     - Sign-up page (`/signup`) with business type selector, owner and branch creation via `TenantSignupSchema`.
     - Dashboard overview (`/dashboard`) with today's sales, sales count, low stock alerts, and open shifts.
     - Products catalog list (`/catalog/products`) with search, category filtering, sticky headers, and tabular right-aligned currency figures.
     - Shop settings form (`/settings/shop`) with timezone, price tax inclusion policy, negative stock policy, and receipt text customization.
  6. **Automated Tests & Screenshots:**
     - Unit tests: `i18n.spec.ts` (parity), `auth-context.spec.tsx` (permission engine), `app.spec.tsx` (login form rendering).
     - Playwright E2E suite (`apps/admin/e2e/auth-flow.spec.ts`): covers invalid credentials, owner sign-in, app shell, language switch, theme switch, sign-out, mobile drawer at 375px, and verifies cashier role is strictly barred from manager/owner navigation.
     - Screenshots captured to `docs/screenshots/a2/`:
       - `desktop-light-login.png` / `desktop-dark-login.png`
       - `desktop-light-shell.png` / `desktop-dark-shell.png`
       - `desktop-light-list.png`
       - `desktop-light-form.png`
       - `mobile-light-login.png` / `mobile-dark-login.png`
       - `mobile-light-shell.png` / `mobile-dark-shell.png`
  7. **CI Workflow:**
     - Integrated `seed:demo`, background API bootstrap, and Playwright Chromium E2E execution into `.github/workflows/ci.yml`.
- **Decisions Made & Why:**
  - Navigation permission gating uses strict parent permission checks (`tenant.read` for settings, `purchase.read` for purchasing, `inventory.read` for stock) so cashier users do not see administrative sections even if assigned individual child permissions like `branch.read`.
  - In `scripts/seed-demo.ts`, added mandatory `id: uuidv7()` and `expectedTotalMinor` to match Phase 1A backend fixes (Fix 2 server calculation and Fix 3 idempotency).
- **Dependencies Added:**
  - `next-themes` (v0.4.6) for dark/light theme switching in Next.js App Router.
- **Skipped:** None.
- **Verification & CI Run Result:**
  - `npm run build`: Passed across all 3 workspaces.
  - `npm run lint`: 0 warnings, 0 errors.
  - `npm test`: 3 passed in admin, 36 passed in api (all green).
  - `npm run test:e2e`: 5/5 Playwright tests passed.
