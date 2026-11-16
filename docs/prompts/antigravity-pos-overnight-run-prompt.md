# Prompt for Antigravity — overnight run: finish the admin dashboard (A1 to A9) and the two remaining backend fixes

Copy everything below the line into Antigravity.

---

You are working in `D:\pos system` (repo `imovi/bangladesh-universal-pos-management-system`). I am going to sleep. You will work alone for the next 5 to 7 hours. Nobody will answer questions, approve plans or look at screenshots until the morning. Your job is to get as far as possible through the work list below, in order, and leave the repo in a state I can review.

The detailed requirements are in three files in the repo. Read all three completely before you start, and commit them with your first commit:

- `docs/prompts/antigravity-pos-phase1b-admin-prompt.md` — the admin dashboard, milestones A0 to A9 (A0 is done).
- `docs/prompts/antigravity-pos-phase1a-fixes2-prompt.md` — backend fixes; Fix 1, 2 and 3 are done, Fix 4 and Fix 5 remain.
- `docs/prompts/antigravity-pos-overnight-run-prompt.md` — this file.

Where this file and the other two disagree, this file wins.

## Unattended mode: rules that replace "ask me" and "wait for me"

1. **Never wait for me.** Every instruction in the other prompts that says "tell me before", "ask me", "stop and list it", "wait for my OK" or "send me screenshots and wait" is replaced by: decide yourself using the rules below, write the decision in `docs/overnight-log.md`, and continue.
2. **Log file.** Keep `docs/overnight-log.md` up to date and commit it with each milestone. One section per milestone with: start and end time, what was built, decisions you made and why, dependencies added, anything skipped, and the CI run result. I will read this first in the morning.
3. **When you are blocked.** Try for at most 30 minutes or 3 different approaches on one problem. Then write it in the log under a heading `BLOCKED`, with the error text and what you tried, leave the smallest safe version in place (a page that says the feature is not ready is fine; a broken build is not), and go on to the next item.
4. **Commands must not hang.** Give every command a time limit (10 minutes for tests and builds, 2 minutes for anything else). Start dev servers in the background and stop them when the step is done. If a command exceeds its limit, kill it, log it and continue. Do not run any check of the Docker installation or its version: Docker is running, and the containers `universal_pos_postgres` (port 5432) and `universal_pos_redis` (port 6379) are healthy. If the database is really unreachable, try `docker compose up -d` once, wait 30 seconds, and if it still fails, log `BLOCKED` and continue with work that needs no database.
5. **Commit and push after every milestone and every fix**, conventional commit messages, so finished work is never lost. Before each push run locally, in this order: `npm run build`, `npm run lint`, `npm run test:cov`. Push only when all three pass.
6. **CI.** After each push, check the GitHub Actions result through the public API (`https://api.github.com/repos/imovi/bangladesh-universal-pos-management-system/actions/runs?per_page=1`); poll at most every 2 minutes for at most 20 minutes. Do not read, search for or use any git credential, token or password on this machine to fetch CI logs. If CI is red while local is green, the cause is almost always an environment difference (missing env variable, missing service, missing browser install): reason about it from the workflow file, fix, push again, at most 3 attempts. If it is still red, log it as `BLOCKED: CI red` with the run URL and continue with the next milestone.
7. **Things you must never do, whatever happens:** weaken or delete a test or assertion, skip a test, lower a coverage threshold, add a coverage exclude, edit a committed migration, force-push, `git reset --hard`, rewrite history, delete the database volume, loosen CORS, disable RLS or a permission guard, commit a secret, or leave `console.log` in committed code.
8. **Missing API.** If a screen needs an endpoint or field the API does not have, do not invent it in the client. Add the smallest backend endpoint that follows the Milestone A1 rules (tenant context, permission guard, shared Zod schema, audit log on writes, real-PostgreSQL tests including a cross-tenant 404 test, `docs/api-spec.md` updated), and list it in the log under `API added`.
9. **Dependencies.** You may add, without asking: shadcn/ui and the Radix packages it needs, `recharts` for charts, `@axe-core/playwright` for accessibility tests, `next-themes` for the theme switch, `@tanstack/react-table` for tables, `date-fns` if needed. Anything else: add it only if there is no reasonable way without it, and log the reason. No package major-version changes in `apps/api` or `packages/shared`.
10. **Design decisions are yours tonight.** Follow the "Design direction" section exactly. Where it leaves a choice, pick the calmer, simpler option. Instead of waiting for my approval after A2, save screenshots with Playwright to `docs/screenshots/<milestone>/` (desktop 1440 px and phone 375 px, light and dark, Bangla and English for the main page of the milestone) and continue. I will give design corrections in the morning; build everything on shared components and CSS variables so a change of look is cheap.
11. **Quality over quantity.** A milestone counts only when its "Done when" tests pass. Do not start the next milestone with the current one half-built unless it is logged as `BLOCKED`. If time runs out, stop at a green, pushed state.

## Work list, in this order

### 0. Housekeeping (15 minutes)

- Commit `docs/prompts/`.
- `apps/admin` lint script: use only `oxlint src` (eslint is not installed).
- `HttpExceptionFilter`: it now copies every extra field of an exception response into the error body. Change it to an explicit whitelist (`limitBp`, `attemptedBp` and any field already asserted by existing tests) so a future exception cannot leak internal data. Add a test.

### 1. Milestone A1 — API gaps

Your audit of the six gaps is approved. Apply these additions:

1. **Supplier statement:** the running balance starts from the opening balance before the requested date range or page, so page 2 and filtered ranges show correct figures. Balance and statement use one shared calculation. Test: a statement for a later date range starts from the correct carried-forward balance, and the last running balance equals `GET /suppliers/:id/balance`.
2. **Tax classes:** setting `isDefault` on one class clears it on the previous default in the same transaction (exactly one default per tenant). Deactivating the default class is rejected with 409. Changing `rateBp` affects future sales only; test that an existing sale's stored tax is unchanged.
3. **Categories:** `PATCH parentCategoryId` rejects self-parent and any descendant as parent (422). The parent must belong to the same tenant.
4. **Uniqueness:** a duplicate code or name on `PATCH` returns 409, not 500. Deactivating a category, brand, collection or tax class still used by products is allowed, and it stays readable on those products.
5. **Tenant isolation:** for every new endpoint (GET, PATCH, DELETE), a test where tenant A's token uses tenant B's id gets 404 and no data.
6. **Lists:** cover every list the dashboard uses, not only products and stock: server-side search, filters, sort (`sortBy` + `sortOrder` from a whitelist, never a raw column name) and pagination for sales, customers, purchase orders, goods receipts, suppliers, users, roles and audit logs, wherever a screen in A3 to A8 needs it. Log which lists you changed and which already had it.
7. **Product list:** default stays `isActive = true` when the parameter is absent.
8. **Stock levels:** pagination changes the response from an array to the standard paginated shape. Update the existing tests to the new shape without removing assertions. Branch and low-stock filters keep working together with search.
9. **Settings:** strict schema (unknown keys rejected); `timezone` must be a valid IANA zone; `currency` cannot change once the tenant has any sale (409). Make sure the read and update permissions exist in `permissions.ts`: Owner has both, Manager read only.
10. **Barcode removal:** 404 if the barcode does not belong to that variant. Variant `PATCH`: `priceMinor` and `costMinor` are non-negative integers.

### 2. Milestone A2 — Sign-in and app shell

As written in the Phase 1B prompt, with these decisions already made so you do not need to ask:

- Session design: build exactly what item 2 of A2 describes (refresh token in an `httpOnly`, `Secure` in production, `SameSite=Lax` cookie set by Next.js route handlers; access token in memory; silent refresh before expiry and once on 401). CSRF protection for the cookie routes: require a custom header plus an `Origin` check against the app's own origin on every state-changing route handler. Write the design as built in `apps/admin/README.md`.
- Add the Playwright end-to-end tests to `.github/workflows/ci.yml` in this milestone: the job needs PostgreSQL and Redis services, the role bootstrap, migrations, `npm run seed:demo`, the API started in the background, `npx playwright install --with-deps chromium`, then the tests. Upload the Playwright report as an artifact on failure.
- Screenshots to `docs/screenshots/a2/`, then continue. Do not wait.

### 3. Milestones A3, A4, A5 — Products, Stock, Purchasing

As written. The size-and-colour grid is used in A3, A4, A5 and A7: build it once as a shared component with tests.

### 4. Backend Fix 5 — payment methods separately in the shift figures

As written in the fixes prompt. Do this **before** A6 so the shift screens are built on the final response shape.

### 5. Milestones A6, A7, A8 — Sales and shifts, Dashboard and reports, Settings and staff

As written. Reminders:
- `POST /sales` now needs a body `id` (UUID) and an equal `Idempotency-Key` header. Any test or seed helper that creates a sale must send both.
- The admin never creates a sale from the interface; sales in e2e tests come from the demo seed or from a test helper that calls the API.
- In the role form the maximum discount percent is required (0 to 100).
- The 403 from a discount limit carries `code`, `limitBp` and `attemptedBp`; the API client's error handling should keep such extra fields available.

### 6. Milestone A9 — Finish

As written. Save the full set of final screenshots to `docs/screenshots/final/`.

### 7. Backend Fix 4 — remove the broad read policies of `pos_system`

As written in the fixes prompt. This is last because it does not affect any screen. Run the whole test suite, including the Playwright tests, after it.

### 8. If time remains

In this order, each as its own commit: (a) raise unit-test coverage of `apps/admin` helpers and the shared grid component; (b) go through every page once more at 375 px in Bangla and fix overflow; (c) read every Bangla string once more and replace word-for-word translations with what a shopkeeper would say. Do not start any feature that is listed under "Out of scope".

## Final report

When you stop (work finished, or about 7 hours passed), write `docs/overnight-report.md`, commit and push it, and print the same text in the chat:

1. A table: every item of the work list with its status (done, partly done, blocked, not started), commit hash and CI result.
2. Everything under `BLOCKED` and `API added` from the log.
3. Dependencies added and why.
4. Decisions you made that I may want to change.
5. Exact commands to run the API and the admin locally and the demo sign-in to use.
6. The URL of the last GitHub Actions run and whether it is green.
7. What you could not verify, and why.
