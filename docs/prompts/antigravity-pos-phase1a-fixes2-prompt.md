# Prompt for Antigravity — Phase 1A, second round of small fixes

Copy everything below the line into Antigravity.

---

You are working in the repo `imovi/bangladesh-universal-pos-management-system` (`apps/api` NestJS 11 + Prisma 6 + PostgreSQL 17, `packages/shared`). The first round of Phase 1A fixes (commits `6c30112` to `6c3b118`) is good and CI is green. A review found five small things left. Fix only these.

## Rules

- Before editing, read the files named in each fix and tell me the files you will touch.
- Tests first, against real PostgreSQL through `apps/api/test/test-db-helper.ts` as `pos_runtime`. No mocked Prisma.
- Never weaken a test, lower a coverage threshold or add a coverage exclude.
- Schema changes are new migrations; do not edit a committed migration.
- One commit per fix, conventional commit messages. GitHub Actions must be green after each push.
- If the admin dashboard work (`apps/admin`) has started, do this on the backend only and tell me if any change here affects a screen already built.

## Fix 1 — A role without a discount limit must mean 0%, not unlimited

**What happens now:** in `apps/api/src/modules/sales/sales-discount.helper.ts`, `resolveUserMaxDiscountBp` returns `null` (no limit) as soon as any of the user's roles has `maxDiscountPercent === null`. `roles.service.ts` saves `dto.maxDiscountPercent ?? null`, so every custom role created without the field gives its users unlimited discount.

**What I want:**
1. A user's limit is the highest `max_discount_percent` among their roles, where `null` counts as 0.
2. Going above the limit is allowed only with the `sale.discount_override` permission (unchanged). The Owner role keeps working because it has that permission; if `isOwner` is used as a shortcut, keep it, but no other path may produce "unlimited".
3. Make the column explicit: new migration that sets existing `NULL` values to 0 for non-owner roles and to 100 for the Owner system role, then makes the column `NOT NULL DEFAULT 0` with a check constraint `0..100`. Update the Zod schema: `maxDiscountPercent` is an integer 0 to 100, default 0. Update `DEFAULT_ROLE_MAX_DISCOUNT` (Owner 100, Manager 20, Cashier 5, Store Keeper 0).

**Verify:** a test where a user has only a custom role created without `maxDiscountPercent`: a 1% discount is rejected with 403. A user with two roles (5 and 20) can give 20%. Owner can give 100%.

## Fix 2 — Measure line and bill discounts together

**What happens now:** `validateUserDiscountLimits` checks each line discount against the limit, and the bill discount against the limit, separately. A cashier limited to 5% can give 5% on every line and another 5% on the bill, about 9.75% in total.

**What I want:**
1. Compute one effective discount for the whole sale: (sum of line discounts + bill discount) ÷ gross before any discount, in basis points, using the figures `calculateSaleTotals` already produces (`totalDiscountMinor` and `grossMinor`) so the check and the stored sale cannot disagree. Round up, so 5.01% is over a 5% limit.
2. Compare that single figure with the user's limit. Keep the per-line check as well, so one line cannot be given 90% and hidden inside a large bill; tell me if you think the per-line check should go, with your reason.
3. A price override is not a discount for this check (it has its own permission), and the gross for the calculation is based on the price actually charged. State this in a code comment and in `docs/api-spec.md`.
4. The 403 error carries a code and the two numbers (limit and attempted, in basis points) so the POS app can show a useful message.

**Verify:** tests with a 5% cashier: 5% line + 0% bill accepted; 5% line + 5% bill rejected; 3% line + 2% bill on a single-line sale: assert the exact effective figure and the outcome; fixed-amount and percent discounts mixed.

## Fix 3 — Make the sale id mandatory

**What happens now:** `id` is optional in `CreateSaleSchema` and the `Idempotency-Key` header is optional. A client that sends neither gets no protection against a double sale after a network retry.

**What I want:**
1. `POST /sales` requires `id` in the body (a UUID; version 7 expected) and the `Idempotency-Key` header, and they must be equal. Missing or different: 400 with a clear code.
2. The same-payload check for a repeat request compares more than total and quantities: also the payments (method and amount), customer, shift, discounts and price overrides. Store a hash of the normalised request with the sale (new nullable column) and compare hashes; rows without a hash fall back to the current comparison.
3. Update `docs/api-spec.md` and every existing test that posts a sale.

**Verify:** tests: no id → 400; header ≠ body id → 400; repeat with same payload → 200 and the same sale; repeat with a different payment split but the same total → 409.

## Fix 4 — Remove the broad read policies of `pos_system`

**What happens now:** migration `20261115160000_pos_system_role` gives `pos_system` `SELECT ... USING (true)` on `branches`, `roles`, `role_permissions`, `users`, `user_roles`, `user_branches` and `audit_logs`. This was item 8 of Fix 6 in the last round and was not done. `SystemDbService` needs to read `tenants` (by slug and id) and `refresh_tokens` (by hash); the signup transaction only inserts.

**What I want:**
1. List every query `SystemDbService` runs and the privileges each one truly needs.
2. In a new migration, drop the `SELECT` policies and revoke `SELECT` on the tables where it is not needed. If Prisma's `create` needs to read back the inserted row, change those calls so they do not (for example generate the id in the application and use `createMany`, or a raw `INSERT` without `RETURNING`), instead of keeping a read-everything policy.
3. If one read policy must stay, narrow it and explain why.

**Verify:** a test connected as `pos_runtime`, switched to `pos_system`: selecting from `users`, `roles`, `branches`, `user_roles`, `user_branches`, `role_permissions` and `audit_logs` returns permission denied or zero rows; signup, login, refresh and logout still pass.

## Fix 5 — Show each payment method separately in the shift figures

**What happens now:** `packages/shared/src/shifts.ts` adds Nagad and Rocket to `bkashSalesMinor`, and everything else to `otherSalesMinor`.

**What I want:** return totals per payment method as a map keyed by the method names in the payment enum (`cash`, `card`, `bkash`, `nagad`, `rocket`, `bank_transfer`), in the close response and the shift report. Keep the existing fields for one release if something already reads them, marked deprecated; otherwise remove them. Derive the list of methods from the shared enum so a new method cannot be forgotten.

**Verify:** a test with one sale per method asserts each total separately, and that the totals add up to the shift's sales total.

## Do not change

- Anything not named above: endpoint paths, the response envelope, the RLS pattern, append-only grants, package major versions.

## Final report

1. Each fix: cause, change, how you verified it.
2. New migrations and any change to request or response shapes (old and new).
3. The URL of the final green GitHub Actions run.
4. Anything you could not do, and why.
