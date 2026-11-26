Prompt for Antigravity — Phase 2.0: module system
Copy everything below the line into Antigravity.

0. Before you start
Finish docs/prompts/antigravity-pos-shift-cleanup-trycatch-note.md first, if it is not done yet. Its last commit must be green in CI. Then start this phase.

This is Phase 2.0. It is about 5 to 7 hours of work. Do it unattended, top to bottom. Do not stop to ask. If something is unclear, choose the safer option, write down why in the log, and go on.

Save this text as docs/prompts/antigravity-pos-phase2-0-module-system-prompt.md in your first commit. Log the work under a new heading ## Phase 2.0: module system at the end of docs/overnight-log.md. Add a new table ## Phase 2.0 to docs/overnight-report.md with one row per commit.

All rules still apply:

CI results only from scripts/ci-status.cjs output, or from the public jobs and annotations API, pasted as they are;
each CI line in the form - CI: `<sha>` → run `<id>` → <status> <conclusion>;
never skip, add retries, fixme, or a longer blind timeout;
every number and output block must be copied from real command output;
wait about 12 minutes after a push, then check at most once every 5 minutes;
never delete or rewrite earlier lines in docs/overnight-log.md. Only add new lines at the end;
add files by name. Never use git add . or git add -A. Restore docs/screenshots with git restore docs/screenshots before each commit;
never write a real secret, token or password into any file. Test credentials for the seeded test data are allowed, like the existing Password123!;
shift cleanup in E2E uses only closeAllOpenShifts(request), never inside try/catch.
Why this phase
The POS must work for many kinds of business: fashion, chemical, pharmacy, grocery, electronics. The core is the same for all of them: sales, stock, purchasing, customers, due, returns, transfers, reports and offline selling. Everything else becomes a module that is active only for the tenants that need it.

This phase builds only the module system. It does not build any module feature: no units, no batches, no expiry, no hazard fields. Those come in later phases.

There are two levels of control:

The platform admin (the person who runs this SaaS) decides which modules a tenant is allowed to use.
The tenant owner turns allowed modules on or off for their own shop.
A module is active for a tenant only when it is both allowed and enabled.

Nothing may change for existing tenants. Every module is off by default. The seeded artisan-apparel fashion tenant must look and work exactly as before, and the 161 E2E tests must stay green.

1. Module registry (shared package)
In packages/shared/src/, add a file modules.ts and export it from the package index:

MODULE_KEYS, a constant list:

units: units and unit conversion;
batch_expiry: batch, lot and expiry, with FEFO;
chemical_safety: hazard class, CAS no, grade, MSDS;
b2b_wholesale: price by customer group, quotation, challan, credit limit;
pharmacy_catalog: generic name, strength, dosage form, MRP;
prescription: prescription records for restricted medicines;
serial_tracking: serial and IMEI numbers;
vat_mushak: VAT invoice (Mushak 6.3).
A ModuleKey type made from that list.

MODULE_INFO: for each key, a Bangla name, an English name, a one-line Bangla description, and dependsOn: ModuleKey[]. Dependencies:

pharmacy_catalog depends on units and batch_expiry;
prescription depends on pharmacy_catalog;
every other module depends on nothing.
DEFAULT_MODULES_BY_BUSINESS_TYPE, keyed by the existing BUSINESS_TYPES:

fashion: none;
chemical: units, batch_expiry, chemical_safety, b2b_wholesale;
pharmacy: units, batch_expiry, pharmacy_catalog, prescription;
grocery: units, batch_expiry, b2b_wholesale;
electronics: serial_tracking;
retail, other and any other type: none.
vat_mushak is never on by default.

A function isModuleActive(flags, key) and a function findMissingDependencies(activeKeys, key). Write unit tests for both.

2. Data
Use the existing FeatureFlag model (feature_flags table). It has tenantId, key and enabled, but no code uses it yet.

Add one column with a new Prisma migration: allowed Boolean @default(false). Do not edit old migrations.
Store each module as one row with key module.<moduleKey>, for example module.units. A missing row means not allowed and not enabled.
Check that the RLS policy on feature_flags works like the other tenant tables: a tenant can only see its own rows. Add an API test that proves tenant A cannot read tenant B's flags.
Do not insert any rows for existing tenants. Every existing tenant stays with no module.
3. Signup defaults
chemical is already in BUSINESS_TYPES, but the signup page at apps/admin/src/app/signup/page.tsx has no option for it. Add it: Bangla কেমিক্যাল, English Chemical.
When a tenant signs up, create one row per default module of its business type, with allowed = true and enabled = true, in the same transaction as the tenant. A fashion signup creates no rows.
Write an API test: a chemical signup gets exactly its 4 modules active; a fashion signup gets none.
4. Tenant API
Add a modules controller in the API. Use the existing JwtAuthGuard and PermissionsGuard.

GET /modules: any signed-in user. Returns every key in MODULE_KEYS with allowed, enabled, active, the Bangla and English names, the description and dependsOn.
PATCH /modules/:key with body { enabled: boolean }: owner only. Use the same owner check as GET /settings/backups. Validate the body with zod.
Unknown key: 400.
Not allowed for this tenant: 403 with code MODULE_NOT_ALLOWED and a Bangla message.
Turning on while a dependency is not active: 409 with code MODULE_DEPENDENCY_MISSING, naming the missing modules.
Turning off while an active module depends on it: 409 with code MODULE_IN_USE_BY_DEPENDENT, naming that module.
Write an audit_logs row with the before and after values.
Add activeModules: ModuleKey[] to the response of GET /auth/me and of GET /settings/pos.
Turning a module off never deletes data. It only hides the module and blocks its API. Turning it on again shows the old data.
5. Module guard
Add a decorator @RequireModule(...keys: ModuleKey[]) and a ModuleGuard in apps/api/src/common/.
The guard reads the tenant's flags once per request.
It returns 403 with code MODULE_DISABLED and a Bangla message when a required module is not active.
The guard runs after JwtAuthGuard.
No real endpoint uses it yet. Prove it with a unit test that has a small test-only controller inside the test file: with the module active the call passes, with it inactive it returns 403 MODULE_DISABLED.
Write a short comment above the decorator that says every endpoint of a module in later phases must use it.
6. Platform admin
There is no platform admin today. Build the smallest safe version.

Table. Add a PlatformAdmin model (platform_admins) with id, email (unique), name, passwordHash, isActive, lastLoginAt, createdAt and updatedAt. It belongs to no tenant. Only the pos_system role may read or write it. Follow the narrowing rules tested in apps/api/test/fix4-narrow-pos-system.spec.ts, and add a test that a tenant-scoped connection cannot read it.
Creating an admin. Do it only with a script: npm run platform-admin:create. It reads the email and name from arguments, and the password from the PLATFORM_ADMIN_PASSWORD env var. It never prints the password or the hash. There is no HTTP endpoint that creates a platform admin.
Login.
Add POST /platform/auth/login with the same throttle as tenant signup.
It signs a JWT with a separate secret, PLATFORM_JWT_SECRET, with the claim scope: "platform" and a 30 minute lifetime. Add the secret to the config validation like JWT_ACCESS_SECRET: min 32 characters, and the forbidden example values rejected in production. Add it to .env.example with a placeholder.
Add a PlatformAuthGuard.
Tests:
a tenant access token on any /platform/* route returns 401;
a platform token on any tenant route returns 401;
a wrong password returns 401 with the same message as an unknown email.
Endpoints, all behind PlatformAuthGuard:
GET /platform/tenants: id, name, slug, businessType, status, and the module rows of each tenant;
PATCH /platform/tenants/:tenantId/modules/:key with { allowed: boolean }. Setting allowed = false also makes the module inactive, but keep the enabled value as it is. It also writes an audit_logs row in that tenant's log. actorUserId stays null. Put the platform admin's id and email in after, under platformActor.
All cross-tenant reads and writes go through SystemDbService with SET LOCAL ROLE pos_system, like the existing code.
7. Admin UI
Platform pages live in the admin app, outside the tenant shell:
/platform/login.
/platform: a table of tenants with their business type and a switch for each module's allowed value.
The platform token is kept only in memory or sessionStorage, never in localStorage, and is not shared with the tenant session.
Keep it plain: use the existing UI components.
Owner page: Settings → মডিউল at apps/admin/src/app/(admin)/settings/modules/.
It lists every module with its Bangla name and description.
An allowed module has an on/off switch. A module that is not allowed shows a disabled switch with the text প্ল্যাটফর্ম থেকে চালু করা হয়নি.
A dependency or in-use error from the API is shown in Bangla next to the switch.
Only the owner sees the switches. Other users see the list without switches.
Hiding by module.
Add a useModules() hook that reads activeModules from the auth context.
Add an optional module?: ModuleKey field to the sidebar items in apps/admin/src/components/layout/sidebar.tsx. An item with a module that is not active is hidden.
No item uses it yet, apart from a unit test for the hook and the sidebar filter.
Offline POS. The POS gets activeModules from GET /settings/pos. Store it with the POS settings the app already keeps for offline use, so the POS knows the modules while offline. The server still checks every request when the sale syncs.
8. Seed and E2E
Add to the demo seed:

a second tenant, chemical-demo, business type chemical, with one owner. Use the same test password as the existing seed. Give it its 4 default modules, allowed and enabled.
one platform admin for tests, with the email platform@test.local and the same test password. It is created only by the seed, never in production.
artisan-apparel gets no module rows.

Write a new E2E spec apps/admin/e2e/module-settings-flow.spec.ts:

The artisan-apparel owner opens Settings → মডিউল. Every module shows প্ল্যাটফর্ম থেকে চালু করা হয়নি. The sidebar is the same as before.
The platform admin signs in at /platform/login and sets allowed on units for artisan-apparel.
The artisan-apparel owner reloads the page, turns units on and sees it active.
The owner tries to turn on pharmacy_catalog, which is not allowed, and the switch stays disabled.
The platform admin sets allowed on pharmacy_catalog for artisan-apparel. The owner turns it on and gets the Bangla dependency error, because batch_expiry is not active.
The chemical-demo owner sees its 4 modules active.
Clean up in afterAll: put artisan-apparel back to no module rows, so later specs see the same tenant as before. This cleanup must fail loudly, like closeAllOpenShifts.
Write API tests for everything marked as a test in sections 1 to 6.

9. Docs
Write docs/modules.md:

what a module is;
the allowed, enabled and active rule;
the default modules per business type;
how to create a platform admin with the script;
how a later phase adds a module: a new key, MODULE_INFO, @RequireModule on every endpoint, and module on its sidebar items.
10. Proof
npx tsc --noEmit in apps/api, apps/admin and packages/shared. Paste the output. Only the known offline-selling.spec.ts 'match' is possibly 'null' error may remain.

The API unit tests. Paste the summary.

The new spec with --repeat-each=5 and retries: 0. Paste the summary. It must be 0 failed.

The whole E2E suite locally once with retries: 0. Paste the summary. It must be 162 or more passed and 0 failed.

git grep -n "PLATFORM_JWT_SECRET" -- . ":!*.md". Paste it, and show that no real secret value is in any file.

Commit in small steps and push. Check every commit with ci-status.cjs on its exact head_sha. The last commit, including a docs-only one, must be green.

For the final commit, paste one line per job (test, smoke-prod, load-check) and the Playwright Run Summary annotation, as printed.

Add a short section ### Screens to the log with screenshots of:

the owner's module page for artisan-apparel;
the owner's module page for chemical-demo;
the platform tenants page.
Save them under docs/screenshots/phase2-0/ and commit only those files.

If CI fails, read the annotation, fix the cause and log it. Three failed fix attempts on one test means BLOCKED: log it with the run URLs and the test name, and stop.

Then stop. Do not start Phase 2.1.
