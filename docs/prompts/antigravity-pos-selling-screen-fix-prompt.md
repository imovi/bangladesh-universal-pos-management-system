# Prompt for Antigravity — fix the selling screen and check every screen against real data

Copy everything below the line into Antigravity.

---

You are working in `D:\pos system` (repo `imovi/bangladesh-universal-pos-management-system`). The unattended-mode rules in `docs/prompts/antigravity-pos-overnight-run-prompt.md` still apply: never wait for me, log every decision in `docs/overnight-log.md` under a new heading `## Selling screen fix run`, commit and push after each part, never weaken or skip a test.

The review of the last run found that the selling screen at `/pos` cannot be used to sell correctly, although all tests were green. The tests passed because they did not check the numbers and labels a cashier actually sees. Fix the bugs, then make the tests strong enough that this kind of bug cannot pass again.

## Part 1 — Bugs on the selling screen (do these first)

### Bug 1: stock shows "NaN" on every product card and in the size-colour picker

Cause found in review: the client reads `stockLevels[].quantity`, but the API and the Prisma model `StockLevel` use the field `qty` (a Decimal, sent as a string). `Number(undefined)` gives `NaN`.

- `apps/admin/src/app/pos/page.tsx` (around line 1270) and `apps/admin/src/components/pos/variant-picker-modal.tsx` (around line 52) read the wrong field.
- Do not fix this by reading two field names. Define one typed response shape for the product list the selling screen uses (in `packages/shared` if the shape is shared, otherwise one type file in `apps/admin/src/lib/pos/`), use it in both places, and remove the `any` types there.
- The in-memory stock decrement after a sale (around line 748 in `page.tsx`) must update the same field.
- A product whose stock is 0 in the current branch shows "স্টক শেষ" / "Out of stock", not 0 or NaN.

### Bug 2: the size-colour picker shows a single "Default / Standard" cell

Cause found in review: `ProductsService` (in `apps/api/src/modules/catalog/products.service.ts`, around line 317) includes `optionValues: { include: { optionValue: true } }` without the option, so `ov.optionValue.option.name` is undefined on the client and every variant falls back to "Default" / "Standard". All variants of a product overwrite each other in one cell, so the cashier can only add one variant.

- Include the option name in the API response (the smallest change: `optionValue: { include: { option: true } }`, or a flat `size` / `colour` per variant if that is simpler for every screen). Check every other screen that reads option values (products list, product detail, stock list, opening stock, goods receipt) still works.
- Seed option names are `Size` and `Color`. Match option names case-insensitively, and treat `Color` and `Colour` the same.
- If a variant really has no size or colour, the picker shows one row or one column with the variant name, not "Default" / "Standard".
- Sizes appear in the order they were created (S, M, L, XL), not alphabetically.

### Bug 3: payment dialog and receipt details

- Payment method choice in the split payment rows uses the shared shadcn `Select`, not a native `<select>` (check; the log says it was edited).
- On the receipt, the "৳" sign and the amount stay on one line (`whitespace-nowrap` on money cells) for 80 mm and 58 mm.
- The header of `/pos` at 1366 px and 1024 px: shift status, cashier name and discount limit must not overlap. For the Owner, show the discount limit as "সীমাহীন" / "No limit", not "∞".

## Part 2 — Tests that would have caught these bugs

1. **Unit tests** for the variant matrix builder and the stock reader, fed with a fixture that is a real API response saved from the demo seed (`apps/admin/test/fixtures/pos-products.json`). Assert: Oxford Formal Shirt gives sizes `M, L, XL` and colours `Sky Blue, White` (or whatever the seed really has; read it from the seed), every cell has a numeric stock, no "NaN", no "Default".
2. **Playwright `pos-flow.spec.ts`:**
   - After the page loads, assert that no element on `/pos` contains the text `NaN`, `undefined`, `null` or `Default`.
   - Assert the stock number on one product card equals the sum read from `GET /inventory/stock-levels` for that product and branch.
   - In the picker for a 6-variant product, assert there are 6 selectable cells, pick a specific size and colour (for example `L / White`), and assert the cart line shows that exact SKU.
   - After completing a sale of quantity 2, assert the card's stock went down by exactly 2, and after a page reload it still shows the reduced number (from the API, not from memory).
3. **A global guard for every page:** add one Playwright test that visits every route in `app-shell-routes.spec.ts` plus `/pos` as Owner, in Bangla and English, and fails if the visible text contains `NaN`, `undefined`, `null`, `Invalid Date` or `[object Object]`. Wait for data to load before checking (no "লোড হচ্ছে..." left on the page).

## Part 3 — Check every screen against real data

The same kind of bug (client reads a field name the API does not send) may exist elsewhere. Do this check once for the whole admin:

1. For every `apiFetch` call in `apps/admin/src`, compare the fields the client reads with the fields the API actually returns (read the service code or call the endpoint against the dev seed). List every mismatch in the log in a table: file, field read, field sent, fixed yes/no.
2. Fix every mismatch the same way as Bug 1: one typed shape, no fallback chains like `a ?? b ?? c` over different field names.
3. Where a page unwraps responses "defensively" for both `data.data` and `data.data.items`, replace it with the one shape that endpoint really returns.

## Part 4 — Screenshots

Retake `docs/screenshots/pos/` (all nine files) and `docs/screenshots/final/final-desktop-pos.png` **after** the fixes, with the shift open and a product picked, so the stock numbers and the full size-colour grid are visible. The final POS screenshot must not be covered by a dialog; if a demo shift is open on that register, close it first or use another register.

## Report

At the end, add a section to `docs/overnight-report.md`:

1. Each bug: cause, fix, commit hash, test that now covers it.
2. The field-mismatch table from Part 3.
3. The CI result for the last commit, taken from the API (`conclusion: success` for that exact `head_sha`).
4. **Commit hashes must be copied from `git log`, not written from memory.** The previous report listed hashes `933f7c9`, `5e85bb7`, `e5008be`, `2f9f592` and others that do not exist in the repository. Correct the table in `docs/overnight-report.md` with the real hashes from `git log --oneline`.
