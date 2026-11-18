# Prompt for Antigravity — Phase 1D: offline selling at `/pos`

Copy everything below the line into Antigravity.

---

You are working in `D:\pos system` (repo `imovi/bangladesh-universal-pos-management-system`). I am going to sleep. You will work alone for 5 to 7 hours, and nobody will answer questions.

**Why this phase matters.** Shops in Bangladesh lose internet and power often. When the connection drops, the cashier must keep selling at `/pos` without waiting, and every sale must reach the server later, exactly once, with correct money, stock and shift figures. A sale that is lost or counted twice is the worst bug this product can have. Work slowly and test hard.

Save this file as `docs/prompts/antigravity-pos-phase1d-offline-mode-prompt.md` and commit it with your first commit.

## Unattended mode

All rules of `docs/prompts/antigravity-pos-overnight-run-prompt.md` ("Unattended mode" items 1 to 11) and the additional rules of `docs/prompts/antigravity-pos-phase1c-returns-due-transfers-prompt.md` apply unchanged. Log in `docs/overnight-log.md` under `## Phase 1D`.

The CI rule from Phase 1C run 3 also applies unchanged:
- after every push, check the API for that exact `head_sha` before you start the next item;
- if CI is red, fixing it is the next item;
- after 3 failed attempts, write `BLOCKED: CI red` with the failing test names, and stop building features;
- "All tests pass locally" never counts as green.

If a command gives no output for 10 minutes, kill it, log it, and continue. **Never stop working without writing in the log why you stopped.** In the last two runs you went silent for hours with nothing in the log.

## Step 0. Leftovers from Phase 1C (30 minutes, one commit each)

1. Already done in `a241d8a` and `c068978`. Only commit this prompt file (`docs/prompts/antigravity-pos-phase1d-offline-mode-prompt.md`, currently untracked).
2. **`/api/v1/health` must not show the database name to everyone.**
   - Return `databaseName` only when `NODE_ENV` is not `production`, or only to a request that carries a test-only header set in the e2e setup. Pick one and log the choice.
   - Add a test that a production-mode app does not return it.
3. **Payment method select.** In the customer due collection modal (`customers/[id]`) and anywhere else that still uses a native `<select>` / `<option>` for payment methods, use the shared shadcn `Select`.
4. **Strings in code.** Move the Bangla and English strings added in Phase 1C that are written inline as `locale === "bn" ? "…" : "…"` into `apps/admin/src/i18n/bn.ts` and `en.ts`.
   - There are about 758 inline `locale === "bn"` uses in `apps/admin/src` today. Do not try to move all of them in this phase. Move the ones in the `/pos` components and the Phase 1C pages (returns, due, transfers, barcodes, C5 reports), and stop after 45 minutes.
   - Add a unit test that counts the inline `locale === "bn" ?` uses in `apps/admin/src` and fails if the count is higher than a baseline number stored in the test. Set the baseline to the count after your move. New offline-mode code must add zero.
   - Log the count before and after.

## Step 1. Design decisions (decided; do not ask)

Read all of these before you write code. Write `docs/offline-mode.md` describing the design as built, with a sequence diagram (Mermaid) of: sell offline → reconnect → sync → server result.

### What works offline

| Works offline | Does not work offline (button disabled, with a clear Bangla and English message) |
|---|---|
| Selling: search, barcode scan, size-colour picker, cart, line and bill discount within the cashier's cached limit, hold and recall carts | Opening a shift and closing a shift (closing needs every sale synced) |
| Payment: cash, and bKash / Nagad / Rocket / card recorded with a reference number (no live check) | Credit sales ("baki"): the customer's limit cannot be checked |
| Printing the receipt (80 mm and 58 mm) | Returns and exchanges: they need the original sale and the drawer figures |
| Cash in / cash out in the open shift | Due collection |
| Attaching a cached customer, or creating a new customer (name and phone) that syncs later | Price changes, product edits, and everything in the back office |
| Reprinting a receipt of a sale made on this device | Barcode generation, stock transfers |

The back office (`(admin)` routes) is online only. When it is offline, it shows a full-page "ইন্টারনেট সংযোগ নেই" message with a link to `/pos`.

### Who may sell offline

- Offline selling is a per-register setting, `allowOffline` (default **on** for new registers, and turned on for the seed registers). A Manager or Owner changes it. When it is off, `/pos` shows a blocking "offline" screen instead.
- The shift must already be open, online, before the connection drops.
- **Reload while offline.** The access token lives in memory, so a reload loses it. To keep selling after a reload or a browser restart while offline:
  - Each user can set a 4 to 6 digit **POS PIN** online (profile menu at `/pos` and the user form in the back office).
  - The server stores the PIN hashed with the same algorithm as passwords.
  - At an online sign-in on a register with `allowOffline`, the device stores an **offline verifier** in IndexedDB: PBKDF2-SHA256 through Web Crypto, at least 210,000 iterations, a random 16-byte salt, and the derived key — never the PIN itself. It also stores the user id, the tenant id, the register id, the role permissions and the discount limit, and an expiry 12 hours after the last online contact.
  - Offline, after a reload, the cashier picks their name and enters the PIN.
  - 5 wrong PINs lock offline unlock on that device until the next online sign-in.
  - When the verifier has expired, offline unlock is refused with a clear message.
- Offline actions use the cached permissions. The server checks them again at sync (see "Server rules at sync").
- **Sign-out** clears the offline verifier and the cached customer data for that user. Sign-out is blocked while unsynced sales exist on the device: show the count, and offer "sync now".

### Local storage

- Use IndexedDB through **Dexie** (allowed; log the version). Call `navigator.storage.persist()` and record the result.
- **Stores:**
  - `catalog`: products, variants, option values, prices, barcodes, tax classes, category names — for the register's branch.
  - `stock`: the last known quantities for the branch.
  - `customers`: id, name, phone and loyalty fields if any — the most recent 5,000 by last purchase.
  - `settings`: tenant settings needed for totals and receipts.
  - `session`: the offline verifier.
  - `outbox`: unsynced writes.
  - `localSales`: copies of receipts made on this device in the last 7 days, for reprint.
- **Catalog sync:**
  - On sign-in, and every 5 minutes while online, call a new endpoint `GET /pos/catalog?branchId=&since=<cursor>`. It returns changed and deactivated rows since the cursor, plus a new cursor and a `catalogVersion`.
  - The first call (no cursor) returns everything.
  - Use one endpoint, not a request per product.
  - Test the full payload with the demo seed scaled to 5,000 variants. Log its size and the time it takes.
- **The UI shows how old the data is:** "দাম আপডেট: ১০ মিনিট আগে". When the catalog is older than 24 hours, show a warning to the cashier but keep selling.

### Sale ids and invoice numbers

- Every sale already has a client-made UUID v7 `id`. That id is the idempotency key, online and offline. Keep it.
- **Offline invoice numbers** use their own series per register: `REG01-O-261118-0001`. The `O` marks offline, and the date is in the tenant's business timezone (same format as online invoices).
- The counter lives in IndexedDB per register and per day.
- The server accepts a client number only if:
  - it matches that register's code and the offline pattern, and
  - it is unique (the existing `@@unique([tenantId, invoiceNumber])` makes a duplicate fail; return 409 `OFFLINE_NUMBER_TAKEN`).
- **Only one `/pos` tab per register may sell.** Use the Web Locks API, with BroadcastChannel as a fallback. A second tab shows "এই রেজিস্টার অন্য ট্যাবে খোলা আছে" and cannot sell. This stops two tabs from using the same number.
- The client keeps `occurredAt` (the device time of the sale) and the server stores it on the sale as a new column `occurred_at`. Online sales set `occurred_at = created_at`.
  - Reports and shift figures use `occurred_at` for business dates. Check every report and the shift figures, and change them where they use `created_at`.
  - The server also stores `synced_at`, plus `is_offline` (boolean) and `catalog_version`.

### Clock

- At every online contact, store `serverTime − deviceTime` as the clock offset. Offline sales store both the device time and the corrected time.
- If the offset is larger than 5 minutes, show a warning on `/pos`. The server uses the corrected time for `occurred_at`, but never a time before the shift opened or after it closed. Clamp it, and flag the sale.

### Outbox and sync

- Every offline write (sale, cash movement, new customer) goes into the outbox in one IndexedDB transaction, together with the local receipt and the local stock decrement. The receipt prints only after that transaction commits.
- **Sync order:** the order the writes were created. A new customer syncs before the sale that uses it. The server keeps the client-made customer id (UUID v7), so the sale's `customerId` stays valid.
- **When sync runs:** on the `online` event, every 30 seconds while items are waiting, and on the "সিঙ্ক করুন" button.
- **Retries:** exponential backoff with jitter (2 s, 4 s, 8 s … up to 5 minutes). Network errors and 5xx responses are retried. A 2xx response, or a 409 meaning "same id, same payload, already stored", marks the item done.
- **Never delete** an outbox item before the server confirms it. "Done" items are kept 7 days and then cleaned up.
- **A 4xx other than idempotent success** (for example 409 `IDEMPOTENCY_CONFLICT`, 422, or 403):
  - mark the item `failed` and keep it;
  - show it in a "সিঙ্ক হয়নি" list at `/pos` with the server's code and message;
  - write it to the server's review list (below) with the full payload;
  - never retry it automatically, and never drop it silently.
- **A batch endpoint is allowed** (`POST /pos/sync` with up to 50 items, each processed in its own transaction, results per item). Each item must keep exactly the same idempotency and validation as the single endpoints. If you add it, test that one bad item does not block the others.
- The device sends each item at most once at the same time: use a lock so that the 30-second timer and the button cannot send the same item in parallel. The server's idempotency is still the final guard.

### Server rules at sync (an offline sale already happened in the real world)

The customer has left the shop with the goods, so the server must not reject an offline sale for business reasons it could not check at the time. Accept it and flag it for review instead:

| Situation at sync | Server action |
|---|---|
| Price or tax in the payload differs from the current price | Accept the client's line prices and tax as sold, if the client's `catalogVersion` shows that price was valid then. Store both. Flag `PRICE_CHANGED`. If no version matches, still accept, and flag `PRICE_UNKNOWN`. |
| Discount above the cashier's current limit | Accept. Flag `DISCOUNT_OVER_LIMIT` with the limit and the attempted value. |
| Stock goes below zero | Accept, even if the tenant forbids negative stock. Write the movement. Flag `NEGATIVE_STOCK`. |
| The user lost the permission, or was deactivated, after the sale | Accept. Flag `PERMISSION_CHANGED`. |
| The shift was closed on the server before this sale arrived | This should be impossible, because closing needs every sale synced. If it happens, accept into that shift, flag `SHIFT_CLOSED`, and do not change the closed shift's counted figures. Show the difference on the review page. |
| Totals in the payload do not match `calculateSaleTotals` on the same lines | **Reject** with 422 `TOTALS_MISMATCH`. This is a bug, not a business event. It goes to the failed list, and a test must show it never happens for valid carts. |
| Wrong tenant, register, or a shift that does not belong to that register | **Reject** (404 or 403). This is a security rule and never a flag. |
| Malformed payload | **Reject** with 422. |

- Flags live in a new table `sale_review_flags` (tenant RLS, audit log on resolve).
- New back-office page `/sales/offline-review`, for Manager and Owner:
  - list of flagged sales and failed sync items, with filters;
  - each flag can be marked "resolved" with a note.
  - The dashboard shows the count of open flags.
- **Permissions:** `sale.offline_review` (Owner and Manager), `register.manage_offline` (Owner and Manager).

### Shift figures

- Offline cash sales and cash movements count in the shift's expected cash once synced.
- At `/pos`, the shift figures shown offline are calculated locally: server figures at the last sync plus the local unsynced writes. They are labelled "অফলাইন হিসাব".
- **Closing a shift** needs zero unsynced and zero failed items on that register. With failed items, the close dialog shows them, and only a Manager or Owner can close, with a reason. That close is audit-logged.

### Screens at `/pos`

- **The header pill** (from run 3) shows the connection state next to the shift state:
  - "● অনলাইন" (green);
  - "● অফলাইন" (amber);
  - "সিঙ্ক হচ্ছে… ৩টি বাকি" (blue);
  - "সিঙ্ক হয়নি: ২টি" (red; clicking opens the list).
  - Keep the run 3 layout rules, and add the new states to `pos-header-layout.spec.ts` at all 8 widths.
- **Going offline** shows a short, non-blocking banner. Coming back online and finishing the sync shows "সব বিক্রি পাঠানো হয়েছে".
- **Disabled actions** show a tooltip that explains why: "অনলাইনে ফিরলে করা যাবে".
- **Offline receipts** print the offline invoice number and a small "অফলাইন" mark.
- **PIN unlock screen** for a reload while offline.
- **Register settings** in the back office: the `allowOffline` switch. **User form:** "POS PIN set / reset".

### Service worker

- Use **Serwist** (`@serwist/next`) for the app shell. It is allowed; log the version.
- Precache the `/pos` route, its JavaScript and CSS, fonts and icons, so that a reload of `/pos` works with no network.
- **Never cache API responses** in the service worker. The data lives in IndexedDB, and the service worker serves only static files.
- **Updates:** a new build shows "নতুন ভার্সন এসেছে — রিফ্রেশ করুন". It never reloads by itself while the cart has items or the outbox has unsynced items.
- The production build is required for offline tests. The dev server does not register the service worker.

## Step 2. Build it, in this order (each a milestone with commit, push and green CI)

- **D1.** Database and API: `occurred_at`, `synced_at`, `is_offline`, `catalog_version` on sales; `allowOffline` on registers; POS PIN; `sale_review_flags`; `GET /pos/catalog`; the offline sale acceptance rules; the offline number rules; optionally `POST /pos/sync`; reports and shift figures moved to `occurred_at`. Include every API test listed under "Tests".
- **D2.** Client storage and sync engine in `apps/admin/src/lib/pos/offline/`. This is plain TypeScript with no React inside, so it can be unit-tested with fake IndexedDB (`fake-indexeddb` is allowed). It contains: Dexie schema, catalog sync, outbox, sync worker with backoff, clock offset, offline counter, tab lock.
- **D3.** `/pos` uses the local store for search, scan, picker and totals, online and offline alike: one code path, not two. Online sales also go through the outbox and are sent at once, so the online and offline paths are the same and both get tested every day.
- **D4.** PIN, offline verifier and unlock screen; service worker; header states; banners; disabled actions; offline receipts.
- **D5.** Back office: `/sales/offline-review`, the register `allowOffline` switch, the user PIN form, the dashboard flag count. Shift close rules.
- **D6.** Hardening: every test below, `docs/offline-mode.md`, and screenshots.

## Tests (a milestone is done only when its tests pass in CI)

### Unit (Vitest, fake IndexedDB)

- **Outbox:**
  - order is kept;
  - an item is not deleted before confirmation;
  - a failed item is never retried automatically;
  - the backoff times are correct;
  - the lock stops parallel sends of one item.
- **Offline invoice counter:**
  - unique across reloads;
  - restarts on a new business day in the tenant timezone (test across midnight and with a device in another timezone).
- **Clock offset and clamping.**
- **PIN verifier:**
  - correct PIN unlocks;
  - a wrong PIN fails;
  - lock after 5 failures;
  - an expired verifier is refused;
  - the PIN itself is never stored (read the whole IndexedDB in the test and search for it).
- **Totals:** the client's totals for 200 random carts (fixed seed) equal `calculateSaleTotals` on the server for the same input. This guards `TOTALS_MISMATCH`.

### API (real PostgreSQL)

- **Same offline sale sent:**
  - twice, in sequence;
  - twice, in parallel (`Promise.all`);
  - each time, exactly one sale, one set of movements and one cash effect.
- **Flags:** each flag in the table above, with exact stored values.
- **Rejected:** `TOTALS_MISMATCH` and the security rejections.
- **Numbers:**
  - duplicate offline number → 409;
  - a number with another register's code → rejected.
- **`occurred_at`:** an offline sale made before midnight and synced after midnight counts on the earlier business date in the sales report, the dashboard and the shift figures.
- **Shift close:** blocked while that register has failed items; Manager close with reason works and is audit-logged.
- **Cross-tenant 404** on every new endpoint.
- **`GET /pos/catalog`:**
  - delta after a price change and after a deactivation;
  - payload size with 5,000 variants logged.

### Playwright (production build, Chromium, `context.setOffline(true)`)

1. **Offline, sell, reconnect.**
   - Sign in, open a shift, go offline.
   - Sell 3 sales: cash; bKash with a reference; a new customer created offline.
   - Each receipt shows an `-O-` number.
   - Go online. The pill goes to "সিঙ্ক হচ্ছে" and then "অনলাইন".
   - Through the API, check:
     - the 3 sales exist with those numbers;
     - stock went down by the right amounts;
     - the shift's expected cash and method totals match;
     - the new customer exists with the same id.
2. **Reload while offline.**
   - Go offline, then reload `/pos`. The page loads from the service worker.
   - The PIN screen appears. A wrong PIN gives an error; the right PIN unlocks.
   - Sell one item, go online, and it syncs.
3. **Connection drops during sync.**
   - Make 5 offline sales. Go online and drop the connection again while the sync is running (use `page.route` to fail the 3rd request once, and set offline after the 2nd).
   - Go online again. All 5 exist exactly once on the server.
4. **Price changed while offline.**
   - Go offline and sell.
   - Through the API, change that product's price.
   - Go online. The sale keeps the old price, appears on `/sales/offline-review` with `PRICE_CHANGED`, and a Manager resolves it.
5. **Disabled actions offline.** Return, credit sale, close shift and due collection are disabled offline and show the message. The back office shows the offline page.
6. **Two tabs.** A second `/pos` tab on the same register cannot sell.
7. **Sign-out offline** is blocked while unsynced sales exist.
8. **Header** at all 8 widths with each connection state: no overlap (extend the run 3 test).
9. **Global data-integrity guard** includes `/sales/offline-review`.

### Screenshots

Save to `docs/screenshots/d1/` to `d5/`, from the production build:
- each header state;
- offline banner;
- PIN screen;
- the "সিঙ্ক হয়নি" list;
- an offline receipt in 80 mm and 58 mm;
- `/sales/offline-review`;
- register and user settings.

Take each at 1440 px and 375 px, Bangla, light. Add dark mode for `/pos`.

## Things you must not do in this phase

- Do not cache API responses in the service worker.
- Do not store passwords, PINs, refresh tokens or access tokens in IndexedDB or `localStorage`.
- Do not make credit sales, returns, or shift open/close work offline. They are out of scope on purpose.
- Do not make the server reject an offline sale for a business reason listed in the flag table.
- Do not drop or overwrite an outbox item without a server confirmation.
- Do not build a second, separate code path for online selling. Use the one outbox path for both.

## If time remains

In this order, each its own commit:

1. A "ডিভাইসের ডাটা" panel in the `/pos` cashier menu: catalog age, outbox counts, storage used, last sync, and a "Clear device data" button (allowed only when nothing is unsynced).
2. An export of failed outbox items to a JSON file, for support.
3. Test with a slow network (Playwright throttling to "Slow 3G"): sales stay instant, and sync catches up.

Out of scope: promotions, loyalty, SMS, payment gateway integration, e-commerce, native mobile apps, background sync after the tab is closed.

## Final report

Add `## Phase 1D` to `docs/overnight-report.md` and print the same in chat. Include:

1. A table of each item (Step 0, D1 to D6, extras): status, the real commit hash from `git log`, and the CI run id and conclusion from the API.
2. New tables, columns, migrations, permissions and endpoints.
3. Dependencies added (Dexie, Serwist, fake-indexeddb) with versions and why.
4. `GET /pos/catalog` payload size and time with 5,000 variants.
5. Every `BLOCKED` entry, and every rule you could not follow, with the reason.
6. Decisions I may want to change.
7. What you could not verify, and why. Real printers, real phones and a real power cut are expected here; say what to test by hand.
