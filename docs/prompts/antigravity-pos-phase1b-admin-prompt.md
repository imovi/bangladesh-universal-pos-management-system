# Prompt for Antigravity — Phase 1B: Admin dashboard for Universal POS

Copy everything below the line into Antigravity.

---

You are working in the repo `imovi/bangladesh-universal-pos-management-system` (npm workspaces monorepo: `apps/api` NestJS 11 + Prisma 6 + PostgreSQL 17, `packages/shared` with Zod schemas, permissions, money and time zone helpers). The Phase 1A backend API exists and CI is green. Build the admin dashboard: the web app a shop owner or manager uses to set up products, stock, purchases, staff and to read reports.

This is the back office. Selling at the counter (scan, cart, payment, receipt print, opening and closing a shift) belongs to the POS counter app, which is Phase 1C and **not** part of this task.

## Who uses it

- A fashion shop owner or manager in Bangladesh, on a desktop or laptop most of the time, sometimes on a phone to look at today's sales.
- They are not technical. Every screen must be usable without training: plain words, obvious primary action, no jargon such as "SKU matrix" or "ledger" in the interface.
- A store keeper who only receives stock, and an accountant who only reads reports, also sign in here. They must see only what their role permits.

## Stack

- New workspace `apps/admin`: Next.js (current stable, App Router) + React + TypeScript strict.
- Tailwind CSS + shadcn/ui components. TanStack Query for server state. React Hook Form with the Zod schemas from `@universal-pos/shared` (reuse them; do not write a second copy of a validation rule).
- `next-intl` (or an equivalent you justify) for Bangla and English.
- Vitest + Testing Library for components and helpers; Playwright for end-to-end tests.
- Do not change the major versions of anything in `apps/api` or `packages/shared`. Tell me every dependency you add and why, before adding anything outside this list.

## Rules

- Work milestone by milestone, in order. One or more commits per milestone, conventional commit messages. After each push, confirm GitHub Actions is green before continuing.
- Before each milestone, read the controllers and `docs/api-spec.md` for the endpoints you will call, and tell me the files you will create.
- **Never invent an endpoint or a response field.** If the API does not offer something a screen needs, stop and list it; the only backend additions allowed are the ones in Milestone A1 plus anything I approve after you ask.
- All API access goes through one typed client module. Types come from `packages/shared` or are generated from the API; no `any` in the data layer.
- Every server response is in the envelope the API already uses. Handle the error envelope in one place and show the user a sentence they can act on, not a status code. Validation errors appear next to the field they belong to.
- Money arrives as integer poisha. Format it only at the edge with one shared formatter (`৳ 1,250.00`). Never do money arithmetic with floating point in the UI; use the functions in `packages/shared/src/money.ts`. Money inputs accept taka with two decimals and convert to poisha once.
- Dates are shown in the tenant's time zone (setting `timezone`, default `Asia/Dhaka`) using the helpers in `packages/shared/src/timezone.ts`. Report filters send business dates (`YYYY-MM-DD`).
- Permissions: read the signed-in user's permissions from `GET /auth/me`. Hide navigation items and actions the user cannot use, and still handle a 403 from the server gracefully. The server remains the authority; the UI check is for clarity only.
- Every list is paginated or virtualised, has a loading state, an empty state that says what to do next, and an error state with Retry. No list loads everything.
- Destructive or irreversible actions (void a sale, adjust stock, cancel a purchase order, deactivate a user) ask for confirmation and say what will happen.
- No secrets in the client bundle. No `console.log` left in committed code.
- Tests are written with the feature, not after. Do not weaken a test or lower a threshold to make CI pass.

## Language

- Bangla and English, switchable from the header, remembered per user. Default is Bangla.
- Every visible string comes from the translation files; no hard-coded text in components. Add a test or lint rule that fails when a key is missing in either language.
- Write the Bangla as a native speaker would say it in a shop ("মজুদ", "বিক্রি", "ক্রয়", "বাকি"), not word-for-word translation. Keep product names, SKUs and barcodes as entered.
- Numbers: Western digits (0-9) in both languages by default, because barcodes, prices on tags and bank figures use them. Add a user preference for Bangla digits only if it costs nothing extra; otherwise leave it out and tell me.
- Use a font that renders Bangla well (for example Hind Siliguri or Noto Sans Bengali) with a matching Latin face, loaded through `next/font`.

## Design direction

No brand exists yet; choose a clean, calm, neutral look and keep it consistent.

- Light and dark themes through CSS variables (shadcn tokens). One accent colour, used for primary actions only. Status colours (success, warning, danger) are used only for status.
- Layout: left sidebar with grouped navigation on desktop, collapsing to a drawer on phones; a header with branch switcher, language switch, theme switch and user menu.
- Desktop first: tables with sticky headers, column sorting and filters. On phones (360 px wide and up) nothing scrolls sideways at page level; wide tables either scroll inside their own container or turn into stacked cards. The dashboard and the reports must be comfortable to read on a phone.
- Dense but readable: 14 px base text in tables, clear hierarchy, numbers right-aligned in tabular figures.
- Forms: labels above fields, one column on phones, sensible keyboard types (`inputmode="decimal"` for money and quantities), the primary button always in the same place.
- Accessibility: WCAG 2.2 AA contrast in both themes, full keyboard operation, visible focus, labelled controls, dialogs trap and restore focus, errors announced to screen readers.
- Show me screenshots (desktop and 375 px, light and dark) of the shell and one list and one form at the end of Milestone A2 before building the rest, so I can correct the look early.

## Milestone A0 — Project setup

1. Create `apps/admin` in the workspace with lint, type-check, unit test and build scripts, wired into the root scripts and into `.github/workflows/ci.yml`.
2. Environment variables validated at start-up (API base URL and anything else you need), listed in `.env.example`.
3. Add the admin origin to the API's `CORS_ORIGINS` example. Do not loosen CORS.
4. README section: how to run API and admin together locally with the demo data from `npm run seed:demo`.

**Done when:** CI builds and tests both workspaces, and a blank page is served locally.

## Milestone A1 — Fill the API gaps the dashboard needs

First, read the API and write me a list of what is missing for the screens below. I already know of these; confirm each one and add any others you find:

1. Shop settings: read and update the tenant's name and settings (`timezone`, `prices_include_tax`, `allow_negative_stock`, currency, receipt header and footer text). The service method exists; there is no HTTP endpoint.
2. Edit and deactivate for categories, brands, collections and tax classes (only create and list exist).
3. Edit a single variant (price, reorder level, active flag) and remove a barcode.
4. List goods receipts (only create and get-by-id exist), filterable by supplier, purchase order and date.
5. A per-supplier balance and statement (purchases received, payments made, balance).
6. Anything the list screens need for server-side search, filter, sort and pagination that the current endpoints do not accept.

For each gap you fix: follow every rule of Phase 1A (queries only through `TenantContextService.runWithTenant`, permission guard, Zod schema in `packages/shared`, audit log on writes, tests against real PostgreSQL as `pos_runtime`, RLS in the same migration for any new table). Update `docs/api-spec.md`. No other backend change.

**Done when:** the list of gaps, what you added for each, and green CI.

## Milestone A2 — Sign-in and app shell

1. Sign-in page: shop code (tenant slug), email, password. Clear messages for wrong credentials and for too many attempts (429). Remember the shop code on the device, never the password.
2. Session handling: the refresh token must not be readable by page JavaScript. Keep it in an `httpOnly`, `Secure`, `SameSite=Lax` cookie set by Next.js route handlers that call the API's login, refresh and logout; keep the access token in memory only. Refresh silently before expiry and once on a 401; if refresh fails, go to sign-in and keep the page the user was on. Sign-out revokes the token on the server. Protect the cookie-based routes against CSRF. Tell me the exact design before you build it.
3. The shell from "Design direction": sidebar, header, branch switcher (the user's branches only; "all branches" where the API supports it), language and theme switches, user menu.
4. Route protection: signed-out users go to sign-in; a signed-in user without permission for a page sees a friendly "no access" page.
5. Shop sign-up page calling the existing signup endpoint, with the same field rules as the shared schema.

**Done when:** e2e tests cover sign-in, wrong password, silent refresh, sign-out, and a cashier-role user not seeing manager-only navigation. Send me the screenshots requested above and wait for my OK.

## Milestone A3 — Products

1. Product list: search by name, SKU or barcode; filter by category, brand, collection, active; shows variant count, price range and total stock.
2. Create and edit a product: name, description, category, brand, collection, tax class, active.
3. Variants made easy: the user types the option names and values (for example Size: S, M, L, XL and Colour: Black, Blue) and sees the grid of all combinations with a SKU suggested for each. They can untick combinations they do not stock, then fill price, cost and barcode per row, with "apply to all" and "apply to this colour/size" shortcuts. Adding a new size later creates only the new combinations.
4. Barcodes: add several per variant, type or scan into the field, clear message when a barcode or SKU is already used.
5. Bulk price change for a product's variants.
6. Categories (with parent), brands, collections and tax classes: simple list-and-dialog management.
7. Cost price is shown only to users whose role may see it; the API already hides it, the UI must not leave an empty column.

**Done when:** an e2e test creates a shirt with 4 sizes × 3 colours, edits one variant's price, adds a barcode, and finds the variant by that barcode.

## Milestone A4 — Stock

1. Stock list per branch: search and filters, quantity, reorder level, low-stock marker.
2. Size-and-colour grid for one product: sizes across, colours down, quantity in each cell, low or zero cells marked. This is the view a fashion shop looks at most; make it fast and clear.
3. Low-stock page.
4. Opening stock: enter quantities and unit cost for many variants at once, using the same grid.
5. Stock adjustment: choose variant, new counted quantity or plus/minus amount, mandatory reason; shows the before and after.
6. Movement history for a variant: date, type, quantity change, who, reference (linking to the sale or goods receipt).

**Done when:** e2e test sets opening stock through the grid, adjusts one cell, and sees both in the movement history.

## Milestone A5 — Purchasing

1. Suppliers: list, create, edit, balance, statement.
2. Purchase orders: create with lines picked by search or barcode (the product grid may be used to enter quantities by size and colour), statuses as the API defines them, cancel with reason.
3. Receive goods against a purchase order (partial receipts allowed, remaining quantity shown) or without one. Show clearly that receiving changes stock and the average cost.
4. Supplier payments: record a payment, method and reference; the balance updates.
5. Print-friendly purchase order and goods receipt pages.

**Done when:** e2e test: create supplier → purchase order → partial receipt → stock went up → payment → supplier balance is correct.

## Milestone A6 — Sales, customers, registers and shifts (read and manage, not sell)

1. Sales list: filter by business date range, branch, shift, cashier, status, payment method; search by receipt number.
2. Sale detail: lines with original and charged price, discounts, tax, payments, change, who sold it; a receipt preview from the receipt endpoint; void with mandatory reason for users with the permission, with the server's refusal for closed shifts shown as a clear message.
3. Customers: list, search by phone or name, create, edit, purchase history and totals.
4. Registers: create, edit, activate or deactivate per branch.
5. Shifts: list and detail with the cash breakdown the API returns (opening, cash sales, change, cash in, cash out, expected, counted, difference) and totals per payment method. Opening and closing a shift happens in the POS app; here it is read-only.

**Done when:** e2e test (with demo data) finds a sale by receipt number, voids it as a manager, and sees the status change; a cashier cannot see the void action.

## Milestone A7 — Dashboard and reports

1. Home dashboard for the selected branch and date (default today, business date): sales total, number of sales, average sale, payment-method split, best-selling items, low-stock count, open shifts. Built from the existing report endpoints; ask before adding a new one.
2. Reports, each with a business-date range picker (today, yesterday, last 7 days, this month, custom), branch filter, a table, a simple chart where it helps, and CSV export of exactly what is shown:
   - Sales summary
   - Sales by product and variant
   - Sales by category, brand, collection
   - Size-and-colour sales grid for a product
   - Profit (only for users with the profit permission)
   - Stock valuation
3. Charts must be readable in both themes and must not rely on colour alone. Every chart has the same numbers available as a table.

**Done when:** unit tests prove the totals shown equal the API figures for the demo data (no client-side recalculation that can drift), and the dashboard is usable at 375 px.

## Milestone A8 — Settings and staff

1. Shop settings (from A1): name, time zone, prices include tax, allow negative stock, receipt header and footer. Explain each switch in one plain sentence.
2. Branches: list, create, edit.
3. Users: list, invite or create, assign roles and branches, deactivate. A user cannot remove their own last admin access.
4. Roles: create and edit, permissions grouped by area with plain-language labels in both languages, and the maximum discount percent as a **required** field (0 to 100) so no role is saved without a limit. System roles are shown but protected as the API requires.
5. Audit log: filter by date, user, action; before and after values in a readable form.

**Done when:** e2e test creates a role with a 5% discount limit and limited permissions, assigns it to a new user, signs in as that user and sees only the permitted pages.

## Milestone A9 — Finish

1. Go through every page at 375 px, 768 px and desktop, in both themes and both languages; fix overflow, truncation and untranslated text. Bangla strings are often longer or taller than English: check buttons and table headers.
2. Accessibility pass with an automated checker in the e2e suite (no serious or critical violations) plus a manual keyboard pass of the main flows.
3. Performance: no page ships a chart or grid library it does not use; lists stay responsive with the demo data multiplied to a few thousand products.
4. `README` for `apps/admin`: structure, how to add a page, how to add a translation, how to run the tests.

## Out of scope

- The POS selling screen, receipt printing, cash drawer, barcode-label printing, offline mode.
- Returns and exchanges, due sales, promotions, loyalty, stock transfers between branches.
- Subscription billing, SMS, payment-gateway integration, e-commerce.
- Changing backend behaviour beyond Milestone A1.

## Final report

Give me:
1. Per milestone: what you built, the tests you added, and anything you left out with the reason.
2. The API gaps found in A1 and exactly what was added to the backend.
3. The session and token design as built.
4. Screenshots of every main page: desktop and 375 px, light and dark, Bangla and English for at least the dashboard, product form and stock grid.
5. The list of dependencies added.
6. The URL of the final green GitHub Actions run.
7. Anything you could not verify, and why.
