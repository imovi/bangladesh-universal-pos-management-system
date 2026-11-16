# Prompt for Antigravity — Phase 1C: returns and exchanges, due sales, stock transfers, barcode labels
Copy everything below the line into Antigravity.

You are working in D:\pos system (repo imovi/bangladesh-universal-pos-management-system). I am going to sleep. You will work alone for 5 to 7 hours. Nobody will answer questions until the morning.

The admin dashboard (A0 to A9), the selling screen at /pos and backend fixes 1 to 5 are done and green. This run adds the four things a Bangladeshi clothing shop needs next: returns and exchanges, sales on credit ("baki"), moving stock between branches, and printing barcode labels.

Save this file as docs/prompts/antigravity-pos-phase1c-returns-due-transfers-prompt.md and commit it with your first commit.

Unattended mode
All rules of docs/prompts/antigravity-pos-overnight-run-prompt.md ("Unattended mode" items 1 to 11) apply unchanged: never wait for me, log in docs/overnight-log.md under ## Phase 1C, 30 minutes or 3 approaches per blocker then BLOCKED and move on, time limits on commands, no Docker version checks, commit and push per milestone, CI checked through the public API, the list of forbidden actions, no invented client fields.

Additional rules for this run:

Faster loop. While building a milestone, run only the tests for the files you touched. Run the full chain (npm run build, npm run lint, npm run test:cov, full Playwright) once, before the push. After pushing, start the next milestone at once and check CI between steps; do not sit and poll.
Commit hashes and CI results in the log and report are copied from git log and from the API response for that exact head_sha. Never write them from memory.
Screenshots are taken from the production build (next build + next start), not the dev server, so the Next.js "N" button is not in them.
Every screen that shows numbers gets a Playwright assertion that compares at least one number on the screen with the API or database value, and the page is added to global-data-integrity-guard.spec.ts.
Backend rules for every new feature
The same as Milestone A1 and the sales module:

Tenant context and RLS on every new table (policies for pos_app; nothing for pos_system unless really needed, and then log why). New migration files only; never edit a committed migration.
Permission guard on every endpoint; new permissions added to permissions.ts and to the seeded roles (Owner all; Manager as stated below; Cashier as stated below).
Shared Zod schemas in packages/shared; money in integer poisha; quantities as the existing Decimal type.
Every write in one database transaction, with an audit log entry and inventory movements where stock changes. Stock never changes without a movement row.
Writes that a cashier can repeat by accident (return, due collection) are idempotent the same way as POST /sales: body id (UUID v7) equal to the Idempotency-Key header, payload hash stored, same id with a different payload returns 409.
Tests against real PostgreSQL, including a cross-tenant test (tenant A's token with tenant B's id gets 404) for every new GET, PATCH and POST that takes an id.
docs/api-spec.md updated.
Bangla and English strings for everything, no mixed-language labels, dates as 16/11/2026.
Work list, in this order
0. Small fix first (15 minutes)
The /pos header at 1366 px and 1024 px still shows the cashier name, the shift badge and "ডিসকাউন্ট সীমা: সীমাহীন" on top of each other (see docs/screenshots/final/final-desktop-pos.png). Fix the layout: give the shift status, the cashier block and the discount limit their own space; at narrow widths move the discount limit into the cashier menu. Add a Playwright check that these three elements' bounding boxes do not overlap at 1366, 1024 and 375 px.

1. Milestone C1 — Returns and exchanges
Rules (decided; do not ask):

A return is always against an original sale, found by invoice number, receipt barcode, or from the sale detail page. Returns without a receipt are out of scope.
Partial returns are allowed. A line can be returned in several returns, but the total returned quantity per line can never exceed the sold quantity. Enforce this in the database transaction with a row lock on the sale lines, not only in the client.
The refund per unit is what the customer really paid for it: the line net after line discount and its share of the bill discount, including its tax. Use the same rounding as calculateSaleTotals. Add unit tests with a sale that has a line discount, a bill discount and two tax rates, and return part of it; the sum of all possible returns must equal the sale total exactly, to the poisha.
Return window: tenant setting return_window_days, default 7. Outside the window a return needs the permission sale.return.override and a reason.
Each returned line has a condition: resellable (stock goes back to the branch where the return happens, movement type sale_return) or damaged (no stock back; movement type sale_return_damaged recorded with quantity 0 for the stock level but kept in the ledger, so the damaged count is visible in a report).
The return happens in an open shift. Refund methods: cash (reduces the shift's expected cash), or the same non-cash method as the original payment (recorded, no cash effect). Refund in cash cannot exceed the cash in the drawer by the shift's own figures; if it would, return 409 with a clear code.
Voided sales cannot be returned. A sale with returns cannot be voided.
Exchange = a return and a new sale in one transaction and one receipt. The difference is paid by the customer (normal payment methods) or refunded to the customer (cash or original method). The discount limit of the cashier applies to the new part as usual.
Numbering: returns get their own number per register, like sales (REG01-R-261116-0001).
Permissions: sale.return (Owner, Manager, Cashier), sale.return.override (Owner, Manager).
Shift figures (paymentMethodTotalsMinor, expected cash) and every report (dashboard, sales report, profit report) show sales minus returns. Add a "returns" line to the shift close summary and to the dashboard.
Screens:

/pos: a "ফেরত / বদল" (Return / Exchange) button (shortcut F6). Scan or type the receipt number, see the sale lines with the quantity still returnable, choose quantities and condition, choose refund method, or switch to exchange which puts the returned items as negative lines in the cart and lets the cashier add new items. Return receipt printed in 80 and 58 mm, clearly titled "ফেরত রসিদ".
Admin: return list (/sales/returns) with search, date range, branch filter and pagination; return detail; the sale detail page shows its returns and the quantity still returnable.
Tests: the rounding test above; over-return rejected (two parallel requests for the last unit, only one succeeds); window and override; cash refund larger than drawer rejected; exchange with customer paying the difference and with refund of the difference; stock levels and ledger after resellable and damaged returns; shift close figures after returns; cross-tenant 404; idempotent retry. Playwright: full return and exchange at /pos with the numbers on the receipt checked.

2. Milestone C2 — Sales on credit (due / "baki") and collecting due
Rules:

A sale may be completed with less paid than the total only if a customer is attached and the cashier has the permission sale.credit (Owner, Manager; Cashier off by default, can be turned on per role).
Each customer has a credit limit (creditLimitMinor, default 0 = no credit). A sale that would take the customer's due above the limit is rejected with 409 and code CREDIT_LIMIT_EXCEEDED including limitMinor and currentDueMinor, unless the user has sale.credit.override (Owner).
The sale stores paidMinor and dueMinor. The customer's due balance is calculated from sales, collections and returns in one shared function (same rule as the supplier statement: one calculation for balance and statement).
A return on a sale with due reduces the due first; only what is left after the due is cleared is refunded.
Collecting due: POST /customers/:id/payments in an open shift (cash counts in the shift's expected cash), idempotent, with method and optional reference. A payment can be applied to the oldest due sales first (FIFO); store the allocation.
Customer ledger: sales, returns, collections, running balance; printable statement for a date range with the correct opening balance.
Receipts of a credit sale show paid, due and the customer's total due after this sale.
Screens:

/pos payment dialog: when a customer is attached and the user may sell on credit, allow "বাকি" for the remaining amount, show the customer's current due and limit. Collect due from /pos (customer dialog → "বাকি আদায়").
Admin: customer list shows due balance and can be sorted by it; customer detail shows ledger and statement; a due report (/reports/due) with ageing buckets 0–30, 31–60, 61–90, over 90 days, per branch.
Dashboard: "আজ বাকি দেওয়া" and "আজ বাকি আদায়" figures.
Tests: credit limit; override; FIFO allocation; return on a due sale; statement opening balance for a later date range equals balance before it; ledger last balance equals GET /customers/:id/balance; shift cash with due collections; cross-tenant 404; Playwright: credit sale, then collection, numbers checked on screen.

3. Milestone C3 — Stock transfers between branches
Rules:

States: draft → sent → received (or cancelled from draft only).
Sending takes stock out of the source branch (movement transfer_out) in one transaction; stock cannot go below zero unless the tenant allows negative stock.
Receiving at the destination may be partial; each line records received quantity. Received stock goes in (movement transfer_in). The difference (sent minus received) is recorded as transfer_loss with a required reason, visible in a report.
Only users assigned to the destination branch (or Owner) can receive.
Permissions: transfer.create, transfer.send (Owner, Manager), transfer.receive (Owner, Manager, Cashier at their own branch).
Numbering per tenant: TRF-261116-0001.
Screens: transfer list with state and branch filters; create transfer using the shared size-and-colour grid with the source branch's stock shown in each cell; send; receive screen with expected vs received per line; printable transfer note (A4). Stock list shows "in transit" quantity per branch.

Tests: send moves stock out; receive partial; loss recorded; non-assigned user cannot receive (403); cancel only from draft; cross-tenant 404; Playwright: create, send, receive with one line short, stock numbers on both branches checked.

4. Milestone C4 — Barcode labels
Rules:

Variants without a barcode can get one generated: EAN-13 using a tenant prefix (200 to 299 range is for in-store use) plus a sequence, with a correct check digit, unique per tenant (database unique constraint). Existing barcodes are never changed.
You may add bwip-js or jsbarcode for rendering; log which and why.
Screens:

Print labels from: a product (choose variants and quantities), a goods receipt (one label per received unit by default), a transfer receipt, or a stock selection.
Label templates: 38×25 mm thermal roll, 50×30 mm thermal roll, A4 sheet of 3×8. Content: shop name, product name, size / colour, price with ৳, barcode with the number under it. Print preview, then window.print() with print CSS that sets exact page size and margins.
The barcode printed must scan back into /pos: add a test that renders a label barcode, decodes the number, and finds the variant through the same search the selling screen uses.
Tests: check-digit unit tests (known EAN-13 examples); uniqueness under parallel generation; Playwright: generate, open preview, assert barcode number and price shown match the API.

5. Milestone C5 — Reports for the new features
Returns report: by day, branch, product, reason, condition; return rate per product.
Damaged stock report from sale_return_damaged and transfer_loss.
Due ageing report (from C2) with export to CSV.
Profit report subtracts returns correctly (test with numbers).
All reports follow the branch in the header, the shared date range picker and the table standard from Part B.
6. If time remains
In this order, each its own commit: (a) the /pos screen at 1024 px and 375 px with return and credit dialogs checked for overflow; (b) Bangla wording pass on all new strings, written the way a shopkeeper speaks; (c) raise unit-test coverage of apps/admin/src/lib/pos/.

Out of scope for this run: promotions, loyalty points, SMS, offline mode, payment gateways, e-commerce, subscription billing.

Final report
Append a ## Phase 1C section to docs/overnight-report.md and print the same in chat:

Table: each item (0, C1 to C5, extras) with status, real commit hash from git log, CI run id and conclusion from the API.
Every BLOCKED entry and every rule above you could not follow, with the reason.
New tables, migrations, permissions and endpoints.
Dependencies added and why.
Decisions I may want to change.
Screenshot folders: docs/screenshots/c1/ to c5/ (desktop 1440 and 375 px, Bangla, light; dark for /pos only).
What you could not verify, and why.
