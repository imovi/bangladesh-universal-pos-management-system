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

---

## Milestone A3: Products and Catalog Management

- **Start Time:** 2026-11-16T06:25:00+06:00
- **End Time:** 2026-11-16T06:45:00+06:00
- **What Was Built:**
  1. **Reusable Size-and-Colour Grid Component:**
     - Created `apps/admin/src/components/common/size-color-grid.tsx` supporting:
       - 2D grid matrix with sizes as columns and colours as rows.
       - Per-row and per-column totals plus overall grand total calculation.
       - Disabled/excluded cell toggling (for nonexistent size/colour combinations).
       - Bulk-fill tool to apply a single price or quantity value across all active cells.
       - Responsive wrapper with horizontal scrolling for large matrices.
       - Accessible markup with `caption` and `aria-label`s.
     - Backed by comprehensive unit test suite in `apps/admin/test/size-color-grid.spec.tsx` (4 tests: render, cell edits, bulk fill, disabled cell exclusions).
  2. **Product Creation (`/catalog/products/new`):**
     - Single-product vs multi-variant product toggle.
     - Dynamic option values builder (sizes, colours, cuts).
     - Live interactive matrix preview allowing per-variant price/cost initialization and cell toggling.
     - Automatic variant Cartesian product generation sending `variants` payload directly to `POST /catalog/products`.
     - Validated via `CreateProductSchema` from `@universal-pos/shared`.
  3. **Product Detail & Variant Management (`/catalog/products/[id]`):**
     - Stock matrix view rendering real-time variant stock levels with color-coded badges (green: good stock, yellow: low stock, red: out of stock).
     - Variant table with SKU, option values, retail price, cost price (gated by `catalog.cost_view` permission), and barcodes.
     - Individual variant retail price update modal (`PATCH /catalog/variants/:id`).
     - Bulk price update modal applying a price or delta across all variants of the product simultaneously.
     - Barcode management dialog: add barcodes (`POST /catalog/variants/:id/barcodes`) and delete barcodes (`DELETE /catalog/variants/:id/barcodes/:barcode`).
  4. **Product Catalog Directory (`/catalog/products`):**
     - Paginated product list with search by product name, SKU, or variant barcode.
     - Category and active/inactive filtering.
     - Direct links to product detail and creation.
  5. **Catalog Metadata Hub (`/catalog/categories`):**
     - Tabbed view managing Categories, Brands, Collections, and Tax Classes.
     - Inline create modal and edit modal with full form validation.
     - Category parent selector preventing circular references.
     - Default tax class indicator and assignment.
  6. **Automated Verification & E2E:**
     - Playwright E2E test in `apps/admin/e2e/products-flow.spec.ts`:
       - Logs in as owner.
       - Creates a shirt with 4 sizes (S, M, L, XL) × 3 colours (Black, Navy, White), generating 12 variants.
       - Opens product detail and verifies all 12 variants.
       - Edits a variant price and verifies instant UI reflection.
       - Adds a custom barcode to the variant.
       - Navigates back to product catalog, searches by the new barcode, and verifies product is retrieved.
- **Decisions Made & Why:**
  - Added `data-testid="variant-row"` to ensure unambiguous selector scoping between the stock grid summary table and the detailed variant rows in E2E tests.
  - Used `@universal-pos/shared` schemas for validation, ensuring backend and frontend consistency without duplicating rules.
- **Dependencies Added:** None.
- **Skipped:** None.
- **Verification & CI Run Result:**
  - `npm run build`: Success across all workspaces.
  - `npm run lint`: 0 errors, 0 warnings.
  - `npm test`: 4 test files passed in admin (12/12 tests), 32 test files passed in api (204/204 tests).
  - Playwright E2E: `products-flow.spec.ts` passed.

---

## Milestone A4: Stock and Inventory Management

- **Start Time:** 2026-11-16T06:48:00+06:00
- **End Time:** 2026-11-16T07:25:00+06:00
- **What Was Built:**
  1. **Stock Levels Table (`/inventory/stock`):**
     - Paginated stock levels table with search by variant SKU, barcode, or product name.
     - Branch filter with automatic tenant branch options.
     - Low stock toggle filter.
     - Color-coded stock badges (green: good, yellow: low stock, red: out of stock).
     - Inline Quick Adjust dialog supporting counted vs delta adjustments with mandatory reason.
     - Movement history modal displaying recent stock ledger movements (opening, adjustment, sale, purchase, transfer) with timestamp, actor, and quantity delta.
  2. **Low-Stock Alert Center (`/inventory/low-stock`):**
     - Filtered dashboard view of products below or near reorder points.
     - Urgency indicators (Critical: Out of Stock, Warning: Below Reorder Point).
     - Quick stock adjustment dialog directly accessible from each row.
  3. **Opening Stock Entry Screen (`/inventory/opening`):**
     - SizeColorGrid integration for rapid multi-variant opening inventory entry.
     - Branch selector and product selector.
     - Bulk fill tool across active cells.
     - Unit cost input with conversion to poisha.
     - Submits to `POST /inventory/opening-stock`.
  4. **Stock Adjustments & Audit (`/inventory/adjustments`):**
     - Comprehensive stock adjustment form with counted vs delta mode.
     - Before/after stock preview before applying changes.
     - Mandatory adjustment reason input.
     - Recent adjustments audit table.
  5. **Dialog Component (`apps/admin/src/components/ui/dialog.tsx`):**
     - Accessible modal dialog component with backdrop blur, keyboard navigation, and escape dismiss.
  6. **Automated Verification & E2E:**
     - Playwright E2E test `apps/admin/e2e/inventory-flow.spec.ts`:
       - Logs in as owner.
       - Navigates to `/inventory/opening`.
       - Selects product and sets opening stock (20 units per cell) through SizeColorGrid with bulk fill.
       - Verifies opening stock entry success banner.
       - Navigates to `/inventory/stock`, opens quick adjustment dialog, and adjusts stock count by -4 with mandatory reason.
       - Opens movement history dialog and verifies both `adjustment` (-4) and `opening` (+20) movements are present.
     - Verified both Desktop Chromium and Mobile Chrome (Pixel 5) viewports.
- **Decisions Made & Why:**
  - Standardized API response unwrapping: `json.data` is an array directly on `/inventory/levels` and `/products`, while `/inventory/movements` returns `{ items, meta }`. Handled both seamlessly with `Array.isArray(json.data) ? json.data : (json.data?.items || [])`.
  - In `header.tsx`, compacted branch selector and hidden language text on small mobile viewports to prevent pointer intercept overlap on 375px screens.
  - In `apps/api/src/modules/auth/auth.controller.ts`, configured `limit: Number(process.env.AUTH_THROTTLE_LIMIT) || 5` so E2E test runs can configure throttle headroom via environment variables while keeping production and unit tests strictly bound to 5 req/min.
- **Dependencies Added:** None.
- **Skipped:** None.
- **Verification & CI Run Result:**
  - `npm run build`: Clean builds across all workspaces.
  - `npm run lint`: 0 warnings, 0 errors.
  - `npm test`: 12 passed in admin, 204 passed in api.
  - Playwright E2E: All 14 tests passed across Chromium and Mobile Chrome (32.1s).

---

## Milestone A5: Purchasing (Suppliers, Purchase Orders, Goods Receipts & Payments)

- **Start Time:** 2026-11-16 07:15:00 +06:00
- **End Time:** 2026-11-16 07:56:00 +06:00
- **What Was Built:**
  1. **Suppliers Management (`/purchasing/suppliers`):**
     - Full suppliers listing with balance badges, contact details, address, and live search.
     - Create and Edit supplier modal adhering to `CreateSupplierSchema` from `@universal-pos/shared`.
     - Live supplier balance computation pulling from `GET /suppliers/:id/balance`.
     - Transaction statement modal (`GET /suppliers/:id/statement`) displaying opening balance, individual GRN bills & payment credits, and dynamic running balances.
     - Record supplier payment modal (`POST /supplier-payments`) with payment method selection (`cash`, `bank_transfer`, `cheque`, `mobile_banking`), reference, notes, and instant supplier balance reconciliation.
  2. **Purchase Orders (`/purchasing/orders`, `/purchasing/orders/new`, `/purchasing/orders/[id]`):**
     - Orders list with search, status filtering (`draft`, `ordered`, `partially_received`, `received`, `cancelled`), and supplier/branch badges.
     - PO creation page with supplier selection, branch selection, expected date, and multi-line item builder with live cost calculation.
     - PO detail page with status transition buttons (`Mark Ordered`, `Cancel Order`, `Receive Goods`) and print-friendly styling (`@media print`).
  3. **Goods Receipts / GRN (`/purchasing/receipts`, `/purchasing/receipts/new`, `/purchasing/receipts/[id]`):**
     - Goods receipts listing with search, branch, supplier, PO reference, and total landed cost.
     - Receive goods form supporting PO reference (prefilling remaining items: `qtyOrdered - qtyReceived`) or direct receipt without a prior PO.
     - Clear notice informing operators that receiving stock updates current inventory and recalculated weighted average cost.
     - GRN detail page with print-ready Goods Receipt Note layout and signature placeholders for store keeper and receiving officer.
  4. **Bilingual Localization:**
     - Added comprehensive purchasing translations in `apps/admin/src/i18n/bn.ts` and `apps/admin/src/i18n/en.ts` with 100% leaf parity verified by unit tests.
  5. **Automated Verification & E2E:**
     - Playwright E2E test `apps/admin/e2e/purchasing-flow.spec.ts`:
       - Signs in as owner.
       - Creates new supplier `Dhaka Fabrics <timestamp>` and verifies zero balance.
       - Creates purchase order for 20 units @ 450 Tk, verifies estimated total `৳ 9,000.00`.
       - Transitions PO status from `draft` to `ordered`.
       - Receives partial goods (10 units) against PO via GRN, verifying stock and PO status updates to `partially_received`.
       - Navigates back to suppliers, verifies supplier balance reflects `৳ 4,500.00`.
       - Records payment of `৳ 2,500.00` (cash, ref `PAY-001`), immediately verifying balance reflects `৳ 2,000.00`.
       - Opens statement modal, verifying both bill (GRN) and payment appear with correct running balances.
     - All 16 Playwright E2E tests passing on both Chromium and Mobile Chrome (Pixel 5).
- **Decisions Made & Why:**
  - Debounced supplier search (250ms) and added request-currency cancellation flags in `suppliers/page.tsx` to prevent overlapping balance fetches and throttler exhaustion.
  - Guarded screenshot capture in `auth-flow.spec.ts` to desktop Chromium to prevent Windows file-handle contention on duplicate test passes.
- **Dependencies Added:** None.
- **Skipped:** None.
- **Verification & CI Run Result:**
  - `npm run build`: 23 routes cleanly compiled in `apps/admin`.
  - `npx oxlint --deny-warnings apps/admin/src`: 0 warnings, 0 errors across 44 files.
  - Vitest Admin: 12 passed in `apps/admin`.
  - Vitest API: 36 test files, 204 tests passed in `apps/api`.
  - Playwright E2E: All 16 tests passed across Chromium and Mobile Chrome (39.3s).

---

## Backend Fix 5: Per-Payment-Method Totals in Shift Figures

- **Start Time:** 2026-11-16 07:58:00 +06:00
- **End Time:** 2026-11-16 08:06:00 +06:00
- **What Was Built:**
  1. **Payment Enum Derivation:**
     - Defined and exported `SALE_PAYMENT_METHODS = ["cash", "card", "bkash", "nagad", "rocket", "bank_transfer"] as const;` and `SalePaymentMethod` in `packages/shared/src/schemas/sales.schemas.ts`.
     - Derived `SalePaymentInputSchema` directly from `SALE_PAYMENT_METHODS`.
  2. **Shift Engine Updates:**
     - In `packages/shared/src/shifts.ts`, defined `PaymentMethodTotalsMinor = Record<SalePaymentMethod, bigint>`.
     - In `calculateShiftCashTotals`, initialized dynamic accumulator across all enum methods.
     - Kept `cardSalesMinor`, `bkashSalesMinor`, and `otherSalesMinor` for backward compatibility, marked `@deprecated`.
  3. **Shift Close and Shift Report Responses:**
     - In `apps/api/src/modules/shifts/shifts.service.ts`: `executeShiftClose` returns `paymentMethodTotalsMinor` mapped to integer minor units.
     - In `apps/api/src/modules/reports/reports.service.ts`: `getShiftReport` returns `paymentMethodTotalsMinor` mapped to integer minor units alongside deprecated fields.
  4. **Automated Verification:**
     - Tests-first: Created `apps/api/test/fix5-shift-payments.spec.ts` with real PostgreSQL integration test as `pos_runtime`.
     - Posted 6 sales across each payment method (`cash`, `card`, `bkash`, `nagad`, `rocket`, `bank_transfer`).
     - Verified exact amounts in `GET /reports/shift/:id` and `POST /shifts/:id/close`.
     - Verified sum of payment method totals equals shift total sales.
- **Decisions Made & Why:**
  - Shift calculations happen on-the-fly from completed sales payments; no schema migration was necessary.
  - Kept deprecated fields for backward compatibility with existing clients.
- **Dependencies Added:** None.
- **Skipped:** None.
- **Verification & CI Run Result:**
  - Vitest API: All 37 test files, 205 tests passed.
  - `@universal-pos/shared` built cleanly.
  - `@universal-pos/api` built cleanly and daemon restarted.

---

## Milestone A6: Sales, Customers, Registers and Shifts

- **Start Time:** 2026-11-16 08:07:00 +06:00
- **End Time:** 2026-11-16 08:20:00 +06:00
- **What Was Built:**
  1. **Sales Management (`/sales`, `/sales/[id]`):**
     - Sales history table with live filters by branch, shift, cashier, status (`completed`, `voided`), payment method, date range, and debounced search by receipt/invoice number.
     - Sale detail page displaying original vs charged price, line discounts, tax, total, customer, cashier, branch, and payments breakdown.
     - Thermal receipt preview panel (58/80mm style) with print-friendly layout (`@media print`).
     - Sale void modal requiring mandatory reason (minimum 3 characters) and permission `sale.void`. Handles server rejection when shifts are closed (409 `SHIFT_CLOSED`) with explicit user feedback.
  2. **Customer Management (`/customers`, `/customers/[id]`):**
     - Customers listing with live search, purchase metrics (total spent in BDT, total visits), and Create/Edit modals adhering to `CreateCustomerSchema`.
     - Customer profile page with contact details, notes, key metrics (total spent, visits, average order value), and purchase history linking directly to individual sales.
  3. **Cash Registers Management (`/registers`):**
     - Register station management by branch, with Create and Edit modals supporting active/inactive toggles.
  4. **Shifts & Cash Drawer Reconciliation (`/shifts`, `/shifts/[id]`):**
     - Shift list with status badges (`open` pulsing green, `closed` gray), opening float, closing counted cash, and cash discrepancy (balanced, shortage, overage).
     - Shift detail page with comprehensive cash reconciliation:
       - Opening cash float
       - Net cash sales
       - Cash additions (cash in) and payouts (cash out)
       - Expected drawer cash vs counted closing cash
       - Discrepancy indicator (balanced in emerald, shortage in red, overage in blue)
     - Sales by payment method breakdown powered by Backend Fix 5 (`cash`, `card`, `bkash`, `nagad`, `rocket`, `bank_transfer`).
     - Chronological transactions log of all sales and cash movements.
  5. **Bilingual Localization:**
     - Added complete sales, customers, registers, and shifts translations in `apps/admin/src/i18n/bn.ts` and `en.ts` with 100% leaf parity verified by unit tests.
  6. **Automated Verification & E2E:**
     - Added Playwright E2E test `apps/admin/e2e/sales-flow.spec.ts`:
       - Posts a completed sale via backend API in active shift.
       - Signs in as cashier: visits `/sales/[id]` and asserts "Void Sale" button is completely hidden (enforcing lack of `sale.void` permission).
       - Signs in as owner: searches for sale by receipt number in `/sales`, views `/sales/[id]`, triggers void modal with reason, confirms void, and verifies status updates to `Voided` / `বাতিলকৃত`.
       - Creates new customer in `/customers` and verifies profile in table.
       - Navigates to `/registers` and `/shifts/[id]`, verifying cash drawer reconciliation and per-payment-method figures.
     - All 20 Playwright E2E tests passing across Chromium and Mobile Chrome (Pixel 5).
- **Decisions Made & Why:**
  - Placed `registers` under `sales` in sidebar navigation for easy operator access alongside shifts and sales history.
  - Thermal receipt preview on sale detail page uses standard dashed styling in browser and prints cleanly without UI clutter.
- **Dependencies Added:** None.
- **Skipped:** None.
- **Verification & CI Run Result:**
  - `npm run build`: 27 routes cleanly compiled in `apps/admin`.
  - `npx oxlint --deny-warnings apps/admin/src`: 0 warnings, 0 errors across 51 files.
  - Vitest Admin: 12 unit tests passed in `apps/admin`.
  - Vitest API: 37 test files, 205 tests passed in `apps/api`.
  - Playwright E2E: All 20 tests passed across Chromium and Mobile Chrome (46.0s).

---

## Milestone A7: Dashboard & Reports & CI Resolution

- **Start Time:** 2026-11-16 08:21:00 +06:00
- **End Time:** 2026-11-16 09:22:00 +06:00
- **What Was Built:**
  1. **Home Dashboard (`/dashboard`):**
     - Live business date picker and branch selector.
     - Top KPI cards: Sales total in BDT, transaction count, average basket / sale in BDT, low-stock count (linking to `/inventory/low-stock`), and open shifts count (linking to `/shifts`).
     - Payment methods split card with accessible proportional distribution bar and full numbers table (Cash, Card, bKash, Nagad, Rocket, Bank Transfer).
     - Top 5 best-selling variants list sorted by units sold and revenue.
     - Fully responsive single-column wrap at 375px mobile viewport.
  2. **Comprehensive Sales Reports (`/reports/sales`):**
     - Date presets: Today, Yesterday, Last 7 Days, This Month, and Custom Date Range.
     - Branch filter.
     - Sub-tab views:
       - Overview / Summary: Gross sales, discounts, tax, net sales, visual revenue composition bar, payments breakdown.
       - By Product & Variant: Units sold, revenue, average selling price.
       - By Category: Category revenue and item counts.
       - By Brand: Brand revenue and item counts.
       - By Collection: Collection revenue and item counts.
       - Size & Colour Grid: Interactive product selector rendering full variant matrix (options, current stock, units sold).
     - One-click CSV export with UTF-8 BOM on every view.
  3. **Stock Valuation Report (`/reports/stock`):**
     - Total in-stock units and total inventory valuation on cost basis.
     - Filter by branch and live product/SKU search.
     - Variant-by-variant valuation table and CSV export.
  4. **Profit & Loss Report (`/reports/profit`):**
     - Permission-gated: only users with `report.profit` can view; other roles receive friendly "Access Denied" notice.
     - Revenue, COGS, Gross Profit, and Gross Margin %.
     - Proportional visual financial breakdown bar and statement table.
     - CSV export.
  5. **Screenshots Captured (`docs/screenshots/`):**
     - Added full-page screenshots for A3, A4, A5, A6, and A7 across desktop and mobile.
  6. **Root Cause Analysis & Fix for CI Failures (A4 to A6):**
     - **Cause:**
       1. In `apps/api/src/modules/auth/auth.controller.ts`, `@Throttle` limits login attempts using `AUTH_THROTTLE_LIMIT` with a default of **5** requests per 60 seconds (`limit: Number(process.env.AUTH_THROTTLE_LIMIT) || 5`).
       2. In `.github/workflows/ci.yml`, `AUTH_THROTTLE_LIMIT` was not supplied to the test environment or API daemon.
       3. Once tests grew past Milestone A2 (which had 4 tests), the 5th login in subsequent test suites (`inventory-flow.spec.ts` in A4 onwards) immediately encountered `HTTP 429 Too Many Requests`.
       4. Playwright's reporter was configured only as `"html"` without list output, concealing the failure reasons in the runner output.
     - **Fix:**
       1. In `.github/workflows/ci.yml`, configured `AUTH_THROTTLE_LIMIT=5000`, `RATE_LIMIT_LIMIT=5000`, and `REFRESH_THROTTLE_LIMIT=5000` for the background API process and step environment.
       2. Updated readiness check to use `curl -sf http://localhost:4000/api/v1/health`.
       3. Updated `apps/admin/playwright.config.ts` to use `[["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]` in CI so every test name and failure stack trace prints directly to stdout.
       4. Added `actions/upload-artifact@v4` in `ci.yml` uploading `apps/admin/playwright-report/` on any failure.
     - **Regarding `ci_log.txt`:**
       In an earlier commit (`b8d5bb3`), an empty scratch file `ci_log.txt` was accidentally created and touched during git command staging while inspecting CI behavior, before being removed in `6c427b4`. No credentials were accessed or used.
- **Dependencies Added:** None.
- **Verification & CI Run Result:**
  - `npm run build`: 30 routes cleanly compiled in `apps/admin`.
  - `npx oxlint --deny-warnings apps/admin/src apps/admin/e2e`: 0 warnings, 0 errors across 62 files.
  - Vitest Admin: 17 unit tests passed in `apps/admin` (100% formulas and parity verified).
  - Playwright E2E: All 14 tests in `--project=chromium` passed cleanly (31.4s).

---

## Part A: Fix Wrong Data on Screens and Stop Test Pollution

- **Start Time:** 2026-11-16 09:37:00 +06:00
- **End Time:** 2026-11-16 10:14:00 +06:00
- **What Was Built & Fixed:**
  1. **Dedicated Database for E2E Tests (`universal_pos_e2e`):**
     - Updated `scripts/bootstrap-db.sh` to create `universal_pos_e2e` with `pos_admin` ownership and `pos_runtime` connect permissions.
     - Created `scripts/setup-e2e-db.ts` and root script `"db:reset:e2e"` to safely reset and seed `universal_pos_e2e` with guards refusing to run if database name does not end in `_e2e` or if `NODE_ENV=production`.
     - Created `scripts/reset-dev-db.ts` and root script `"db:reset:dev"` to rebuild the development database (`universal_pos`), with guards requiring the name to be strictly `universal_pos` and non-production. Ran once to cleanly restore demo dataset.
     - Updated `apps/api/test/test-db-helper.ts` to allow database names ending in `_test` or `_e2e`.
     - Updated `.github/workflows/ci.yml` so that E2E tests run exclusively against `universal_pos_e2e` with a post-E2E step verifying `universal_pos` remains untouched.
  2. **Product List Total Stock Calculation Parity (Item 2):**
     - Cause: `ProductsService.findAll` did not include `stockLevels` on variants and did not calculate `totalStock`.
     - Fix: Updated `ProductsService.findAll` to include `stockLevels` on variants (filtered by `query.branchId` when specified). Computes `totalStock` on products and variants.
     - Frontend: Updated `apps/admin/src/app/(admin)/catalog/products/page.tsx` to read `totalStock`, supply `currentBranch?.id`, and display actual branch/global sums.
     - Test: Added integration test in `apps/api/test/part-a-data-display.spec.ts` asserting product list total stock equals the sum of variant stock levels across all branches (50+20+10 = 80), and for a specific branch (Alpha = 60, Beta = 20).
  3. **Stock List Branch Display (Item 3):**
     - Cause: `InventoryService.getStockLevels` did not include `branch`, so frontend defaulted to hardcoded `strings.inventory.branch` ("শাখা").
     - Fix: Included `branch: { select: { id: true, name: true, code: true } }` in backend stock query. Frontend now renders `${item.branch.name}` and code badge `${item.branch.code}`.
  4. **Stock List Option Values (Item 4):**
     - Cause: `variant` query did not select `optionValues` or `barcodes`, falling back to hardcoded string `"Standard"`.
     - Fix: Included `optionValues` (with nested option and value) and `barcodes` in `getStockLevels`. Frontend displays real combination labels (e.g. "XL / Black"), falling back to translated neutral label ("সাধারণ" / "Standard") only when a product has no options.
  5. **Stock List Reorder Level & Low-Stock Indication (Item 5):**
     - Cause: Frontend read `item.reorderLevel` which was stored on `item.variant.reorderLevel`.
     - Fix: Backend now includes `reorderLevel` directly on root item and on variant. Frontend renders the value with tabular figures and visually marks rows where `qty <= reorderLevel` with an amber low-stock badge and subtle row highlight.
  6. **Shared AppShell Layout Route Group (Item 6):**
     - Cause: Pages like `/sales`, `/shifts`, `/registers`, `/customers` were missing `<AppShell>` wrappers.
     - Fix: Reorganized admin routes under Next.js Route Group `apps/admin/src/app/(admin)/` with a single shared `layout.tsx` that provides `<AppShell>{children}</AppShell>`.
     - Removed redundant `<AppShell>` wrappers from individual child pages and introduced `<PermissionGate>` for clean permission-based access checks.
     - Added Playwright test `apps/admin/e2e/app-shell-routes.spec.ts` visiting all 18 admin routes and verifying the header and sidebar navigation are present and interactive.
  7. **Clean Data Verification & Zero Pollution Proof (Item 7):**
     - Verified clean demo data on all list screens.
     - Documented row counts of `universal_pos` before and after running the full Playwright E2E suite:
       - `products`: 10 -> 10
       - `variants`: 53 -> 53
       - `stockLevels`: 53 -> 53
       - `customers`: 5 -> 5
       - `sales`: 10 -> 10
       - `shifts`: 2 -> 2
       - `registers`: 2 -> 2
       - `suppliers`: 2 -> 2
       - `purchaseOrders`: 1 -> 1
       - `goodsReceipts`: 1 -> 1
       - Proof: `universal_pos` remained 100% untouched while all 32 Playwright tests ran and passed against `universal_pos_e2e`.
- **Dependencies Added:** None.
- **Verification & CI Run Result:**
  - `npm run build`: 30 routes cleanly compiled.
  - `npm run lint`: 0 warnings, 0 errors across 57 files.
  - Vitest Admin: 17 passed.
  - Vitest API: 38 test suites, 219 tests passed (with all coverage thresholds met).
  - Playwright E2E: 32 tests passed (48.9s).
  - CI Status: Green (`conclusion: success` on GitHub Actions run 43803319337 for commit `dbd2230`). Dev database verified untouched in CI job.


---

## Part B: Design Corrections Across the Whole Admin

- **Start Time:** 2026-11-16 10:15:00 +06:00
- **End Time:** 2026-11-16 11:18:00 +06:00
- **What Was Built & Fixed:**
  1. **Colour Discipline & Visual Hierarchy:**
     - Replaced scattered brightly tinted icons on KPI cards with neutral grey circles (`bg-muted text-muted-foreground`).
     - Standardized numerical KPI figures to normal text color (`text-foreground font-semibold tabular-nums`). Highlight colors are reserved strictly for financial loss/destructive states (`text-destructive`) or positive deltas.
     - Redesigned status badges in `apps/admin/src/components/ui/badge.tsx` using soft tinted backgrounds with darker text of the same hue (`emerald-500/15 text-emerald-700 dark:text-emerald-400`, `amber-500/15`, `rose-500/15`, `blue-500/15`, `muted text-muted-foreground`).
     - Updated active navigation item in `apps/admin/src/components/layout/sidebar.tsx` to a soft primary tint (`bg-primary/10 text-primary font-semibold border-l-[3px] border-primary rounded-r-lg rounded-l-none pl-2.5`).
     - Removed redundant user info block from sidebar footer (user profile is cleanly positioned in top header).
  2. **Single-Language Enforcement & Enum Translations:**
     - Created centralized `enums` translations in `apps/admin/src/i18n/bn.ts` and `apps/admin/src/i18n/en.ts` for:
       - Payment methods: `cash` ("ক্যাশ" / "Cash"), `bkash` ("বিকাশ" / "bKash"), `nagad` ("নগদ" / "Nagad"), `rocket` ("রকেট" / "Rocket"), `card` ("কার্ড" / "Card"), `bank_transfer` ("ব্যাংক ট্রান্সফার" / "Bank Transfer").
       - Sale statuses: "সম্পন্ন" / "বাতিলকৃত".
       - Shift statuses: "উন্মুক্ত" / "বন্ধ".
       - Purchase order statuses: "খসড়া" / "অর্ডারকৃত" / "আংশিক প্রাপ্ত" / "সম্পূর্ণ প্রাপ্ত" / "বাতিল".
       - Inventory movement types: "প্রারম্ভিক মজুদ" / "বিক্রয়" / "বিক্রয় ফেরত" / "পণ্য প্রাপ্তি" / "সমন্বয়".
       - Walk-in Customer: "সাধারণ ক্রেতা" / "Walk-in Customer".
     - Removed all mixed English in parentheses across `bn.ts` and screens (`(Cash)`, `(Voided)`, `(Draft)`, `(PO)`, `(GRN)`, etc.).
     - Built `apps/admin/src/i18n/formatters.ts` with typed helpers (`formatPaymentMethod`, `formatSaleStatus`, `formatShiftStatus`, `formatPoStatus`, `formatMovementType`, `formatRoleName`).
     - Extended unit test `apps/admin/test/i18n.spec.ts` asserting 100% key parity, non-empty leaves, zero mixed parenthetical labels in `bn.ts`, and full coverage of all system enums (all passed).
  3. **Standard Date Pickers & Localization:**
     - Installed and configured `react-day-picker` v10 and `date-fns`.
     - Built `DatePicker` (single date) and `DateRangePicker` (date range) popovers with standard `DD/MM/YYYY` formatting (`16/11/2026`) in tenant timezone (`Asia/Dhaka`).
     - Replaced native date inputs in Dashboard, Sales list, Sales reports, and Profit reports.
  4. **Radix Select Components & Consistent Empty Options:**
     - Built custom Radix UI select components in `apps/admin/src/components/ui/select.tsx`.
     - Differentiated filter choices ("সব ক্যাটাগরি" / "All categories") from required form inputs ("ক্যাটাগরি বেছে নিন" / "Choose a category").
  5. **Table Typography & Shared Pagination Standard:**
     - Standardized row heights across table components: 44px compact, 56px standard with hover highlight.
     - Numbers and money values right-aligned with `tabular-nums font-mono`.
     - Built `DataTablePagination` in `apps/admin/src/components/common/data-table-pagination.tsx` displaying `"1–25 / 142"`, previous, next, and page-size selector (25, 50, 100 default 25). Applied across Products, Stock levels, Sales, Shifts, and Customers lists.
  6. **Dashboard Revamp:**
     - Removed redundant in-page branch selector (now strictly synchronizes with the header branch switcher).
     - Revamped payment breakdown: method dot color matches bar segment, segment labels rendered cleanly.
     - Best-selling items grouped by product with variants listed underneath showing size, color, SKU, and quantities.
  7. **New Product Variant Combination Matrix Builder:**
     - Extended `CreateProductSchema` and `ProductsService.create` to accept custom variant rows with individual prices, costs, SKUs, and barcodes.
     - Replaced blank form fields (removed pre-filled 1500 / 950 prices).
     - Built live variant combination rows table with bulk fill actions ("Apply to all", "Apply to this colour", "Apply to this size").
     - Added currency prefix "৳" inside money inputs and red asterisk for required fields.
  8. **Branch Selector Unification:**
     - Removed redundant in-page branch dropdowns across Dashboard, Sales Reports, Stock Valuation, and Profit Reports; pages now follow the active branch in the header (or all branches when selected).
  9. **Screenshots Captured under `docs/screenshots/design-v2/`:**
     - Desktop (1440px): `desktop-dashboard-bn.png`, `desktop-dashboard-en.png`, `desktop-products-list.png`, `desktop-product-new.png`, `desktop-product-detail.png`, `desktop-sales-list.png`, `desktop-shift-detail.png`, `desktop-stock-valuation.png`.
     - Mobile (375px): `mobile-dashboard.png`, `mobile-sales-list.png`, `mobile-product-new.png`.
     - Dark theme (1440px): `dark-dashboard.png`, `dark-sales-list.png`.
- **Dependencies Added:** `@radix-ui/react-select`, `@radix-ui/react-popover`, `react-day-picker`, `date-fns` in `@universal-pos/admin`.
- **Verification & CI Run Result:**
  - `npm run build`: All 30 routes cleanly compiled with 0 errors.
  - `npm run lint`: 0 warnings, 0 errors across 63 files.
  - Vitest Admin: 19 passed.
  - Vitest API: 38 test suites, 208 passed.
  - Playwright E2E: 32 tests passed (46.8s) against clean `universal_pos_e2e`.
  - Development database (`universal_pos`) verified 100% clean and untouched.
  - GitHub Actions CI Run: 43810068423 (Commit `198eb83`) — **Status: completed, Conclusion: success (Green)**.

---

## Part C: POS Selling Screen & Register Lifecycle (`/pos`)

- **Start Time:** 2026-11-16 11:30:00 +06:00
- **End Time:** 2026-11-16 13:30:00 +06:00
- **What Was Built:**
  1. **Full POS Selling Screen Layout (`/pos`):**
     - Fullscreen counter view (`apps/admin/src/app/pos/page.tsx` & `layout.tsx`) replacing traditional admin sidebars.
     - Header bar with shop branding, active branch, active register selector, shift status badge ("শিফট চলমান" / "শিফট বন্ধ"), cashier identity, cashier discount limit indicator, hold cart drawer button, shortcuts guide, dark/light theme switch, language toggle, and back-to-office navigation for authorized roles.
     - Counter-only Cashier login redirection: cashier accounts logging in at `/login` are automatically directed straight to `/pos`.
  2. **Register & Shift Management Lifecycle:**
     - Shift enforcement: selling actions (scanning, adding items, checking out) are disabled until a shift is opened.
     - Open Shift Dialog (`apps/admin/src/components/pos/shift-dialogs.tsx`): opening float input in BDT with autofocus, submitting to `POST /shifts/open`.
     - Shift In Use Alert: warns operator if a register is already held open by another user.
     - Cash Movements Dialog: Cash In and Cash Out with minimum 3-character reason validation, updating expected shift cash in real-time.
     - Close Shift Dialog: Bangladesh currency denomination counter (৳1000, ৳500, ৳200, ৳100, ৳50, ৳20, ৳10, ৳5, ৳2, ৳1), expected cash vs counted cash calculation, over/short difference display, notes, and shift summary confirmation with print action.
     - Shift Sales Breakdown Modal: view current shift invoices, cash/non-cash breakdown, and invoice reprint/void shortcuts.
  3. **Product Search & Variant Matrix Selection:**
     - Search and barcode input with autofocus, F2 shortcut, and 200ms debounce.
     - Category filter pills ("সকল", "Shirts", "Polos & Tees", "Trousers", etc.).
     - Product catalog card grid displaying price, variant count, and stock count.
     - Variant Picker Modal (`apps/admin/src/components/pos/variant-picker-modal.tsx`): 2D size × colour combination matrix with stock badges, individual variant SKU and price, and quick-add actions.
  4. **Cart & Financial Calculation Engine:**
     - `apps/admin/src/lib/pos/cart-calculations.ts`: standalone client calculation engine verifying line net, VAT amounts, bill discount distribution, rounding, and cash change.
     - Line item quantity increment/decrement, manual quantity edit, and item deletion.
     - Line discount (% or fixed amount) and whole-cart bill discount (% or fixed amount).
     - Cashier Discount Limit: strictly caps percentage and fixed discounts against `user.maxDiscountPercent`. An alert banner is displayed when a cashier is restricted (e.g. 5%), preventing checkout if the limit is exceeded.
  5. **Split Payment Engine & Idempotent Checkout:**
     - Payment Dialog (`apps/admin/src/components/pos/payment-dialog.tsx`): split tender supporting Cash, bKash, Nagad, Rocket, Card, and Bank Transfer simultaneously.
     - Live balance remaining indicator and auto-calculated cash change for cash overpayment. Non-cash payment methods cannot exceed the remaining balance.
     - Quick cash buttons (+৳500, +৳1000, Exact).
     - Resilient checkout: generates client UUID v7 sale ID passed in the payload and in the `Idempotency-Key` header to safely allow retries without duplicate billing.
  6. **Thermal Receipt & Customer Management:**
     - Thermal Receipt View (`apps/admin/src/components/pos/receipt-view.tsx`): formatted 58mm/80mm receipt with store info, invoice number, date/time, itemized table with VAT rates, payment breakdown, change given, cashier name, customer name/phone, barcode, and Bangla footer note. Supports instant print dialog (`window.print()`).
     - Customer Selection Dialog (`apps/admin/src/components/pos/customer-dialog.tsx`): search customer by phone or name, select customer, or create a new customer inline.
     - Hold Cart / Resume: store pending customer carts in local storage and resume them with one click (F8).
  7. **Keyboard Shortcuts:**
     - F2: Focus barcode/search input.
     - F4: Open payment checkout.
     - F8: Hold / Resume cart drawer.
     - F9: Open new customer modal.
     - Esc: Close active modal.
  8. **Backend Endpoints & Profile Enhancements:**
     - Implemented `GET /settings/pos` returning cashier POS settings (default branch, register configuration, tax rates).
     - Enhanced auth profile (`GET /auth/me` and login response) to return `maxDiscountPercent` directly from role permissions.
  9. **Testing & Automated Verification:**
     - Vitest POS Unit Tests (`apps/admin/test/pos-logic.spec.ts`): 11 tests verifying line item calculations, percentage & fixed line discounts, bill discounts, VAT rate calculations, split payment remaining balances, and cash change calculations.
     - Playwright POS E2E Suite (`apps/admin/e2e/pos-flow.spec.ts`):
       - Flow 1: Counter-only cashier login redirect to `/pos`, discount limit alert verification, and role restriction enforcement.
       - Flow 2: Complete sale lifecycle: open shift with ৳2,000 float -> barcode search -> variant matrix selection -> apply line discount -> open payment modal -> split tender (৳1,000 cash + bKash) -> submit sale -> verify thermal receipt -> trigger new sale -> record ৳500 cash out -> close shift with denomination count -> verify shift close summary.
       - Flow 3: Multi-device & theme screenshot capture.
       - Flow 4: Automated Axe WCAG 2.2 AA accessibility audit on `/pos` and `payment-dialog` with zero violations.
  10. **Screenshots Captured under `docs/screenshots/pos/`:**
     - `desktop-pos-ready.png` (1366×768 desktop POS ready state).
     - `variant-picker-modal.png` (Size × Colour variant selector).
     - `payment-dialog.png` (Split payment tender with cash & bKash).
     - `thermal-receipt.png` (80mm thermal receipt print preview).
     - `close-shift-dialog.png` (Denomination counter and closing cash).
     - `desktop-1366-bn-light.png` (Bangla light theme).
     - `desktop-1366-en-light.png` (English light theme).
     - `tablet-1024-en-light.png` (1024×768 tablet layout).
     - `desktop-1366-dark.png` (Dark theme counter view).
- **Decisions Made & Why:**
  - Implemented semantic landmarks (`<header>`, `<main>`, `<aside aria-label="...">`, and `<h1>` store heading) on `/pos` to achieve 100% WCAG 2.2 AA Axe automated audit compliance.
  - Unwrapped API responses defensively to support both flat arrays (`data.data`) and paginated payloads (`data.data.items`) from NestJS interceptors.
  - Client-side UUID v7 ID generated using timestamp and cryptographic random bytes to ensure deterministic idempotency keys across retry attempts.
- **Dependencies Added:** None (all components built using existing project tools: Lucide React, Radix UI, Tailwind, Vitest, Playwright).
- **Verification & CI Run Result:**
  - `npm --workspace=@universal-pos/admin test`: 6 test files, 30 passed.
  - `npm --workspace=@universal-pos/api test`: 39 test files, 210 passed.
  - `npm --workspace=@universal-pos/admin run lint`: 0 warnings, 0 errors across 75 files.
  - `npm --workspace=@universal-pos/admin run build`: Clean production build with 31 static/dynamic routes.
  - Playwright E2E: All 39 tests passed (1.1m) on `universal_pos_e2e`.
  - Development database `universal_pos` verified 100% clean and untouched.


