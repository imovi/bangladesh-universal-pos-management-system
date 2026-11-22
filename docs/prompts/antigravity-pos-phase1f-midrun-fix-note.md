Prompt for Antigravity — Phase 1F, mid-run fix note
Copy everything below the line into Antigravity.

Finish your current commit. Then do this before you start F2. It is about 60 to 90 minutes. After that, go back to the Phase 1F plan where you left it. All Phase 1F rules still apply:

no credentials and no real servers;
CI results only from scripts/ci-status.cjs output;
report content built by script.
Save this text as docs/prompts/antigravity-pos-phase1f-midrun-fix-note.md in your first commit for it. Log the work under ### Mid-run fix note inside ## Phase 1F in docs/overnight-log.md.

Review found five problems at f83e420. Fix them in this order.

1. Placeholder secrets pass the production check (fix first)
What review found. Review ran the shipped envSchema with:

NODE_ENV=production;
JWT_ACCESS_SECRET=replace-with-generated-jwt-access-secret-min-32-chars;
JWT_REFRESH_SECRET=replace-with-generated-jwt-refresh-secret-min-32-chars;
a valid CORS_ORIGINS.
safeParse returned success: true. These are exactly the placeholder values in deploy/.env.production.example. The values are longer than 32 bytes, and the code only rejects the old .env.example strings.

Why it matters. An owner who forgets to replace the placeholders gets a running app. The repo is public, so anyone can sign tokens for it.

The compose file has the same gap for the database. It has POSTGRES_PASSWORD:-pos_secret and POSTGRES_RUNTIME_PASSWORD:-pos_runtime_secret. A missing env file silently gives weak passwords.

Fix.

In config.service.ts, when NODE_ENV is production, reject every one of these values:

a JWT secret that contains replace-with, change-me or example, in any case;
a JWT secret equal to any value in .env.example or deploy/.env.production.example. Read the forbidden values from one exported list, not from copies.
access and refresh secrets that are equal to each other;
a DATABASE_URL password that is pos_secret, pos_runtime_secret, or contains replace-with.
Each rule gets its own clear error message. None of the messages may print the secret itself.

In deploy/docker-compose.prod.yml, replace every secret default with the required form:

${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD in deploy/.env.production}
the same for POSTGRES_RUNTIME_PASSWORD, JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.
Non-secret defaults (ports, user names, expiry) may stay.

Tests. Add them to production-config.spec.ts:

each placeholder from both example files is rejected;
equal access and refresh secrets are rejected;
each weak DB password is rejected;
a test that the error text never contains the secret value;
a valid generated set (from the same logic as gen-secrets.cjs) passes.
Add one CI step in smoke-prod:

copy the example file without replacing the placeholders;
run docker compose config, or start the api, and expect a non-zero exit;
print placeholder env refused: OK.
2. The validator silently skips new run ids
What review found. verify-report-refs.cjs matches run ids with 44\d{9}. New runs start with 45, for example 45030935054 and 45033806284 in the Phase 1F log. On ## Phase 1F it printed 0 unique run ID(s) and passed.

There is a second gap. The log writes Commit 1: and CI Run 1: on separate lines, so the head_sha pairing never runs.

Fix.

Match any 10 to 12 digit number that is in an actions/runs/<id> link or labelled as a run. Do not depend on the leading digits.
Make the validator fail in each of these cases:
a section contains the words CI Run or Run with a number, but no run id is found;
a run id has no commit hash on the same line.
From now on, write each CI result in the log as one line, in this format:
- CI: `<short sha>` → run `<run id>` → `<status> <conclusion>` (pasted from ci-status.cjs)
Rewrite the existing Phase 1F log lines (Step 0 and F1) to this format. Use ci-status.cjs output only.
If the API is rate limited, wait and retry later.
Do not type a conclusion.
Tests. Extend test-verify-report-refs.cjs with:

a section with a 45… run id and a wrong conclusion, which must exit 1;
a run line with no commit, which must exit 1;
a section that says "CI Run" but has no id, which must exit 1.
Then run the validator on:

## Phase 1D, fixes;
## Phase 1D, fixes follow-up;
## Phase 1E;
## Phase 1F.
Paste all four outputs into the log. If an older section now fails, fix that section's text. Never loosen the check to make it pass.

3. HSTS preload in the Caddyfile
deploy/Caddyfile sends max-age=31536000; includeSubDomains; preload.

Preload and includeSubDomains are very hard to undo. They would force HTTPS on every subdomain of the owner's domain for a long time, including ones the owner uses for other things.

Fix.

Change the header to max-age=31536000.
In docs/go-live/deploy.md, add one short paragraph: what preload does, and why it is off by default.
4. The smoke test does not prove the database role
The prompt says the app runs as pos_runtime without superuser rights. Nothing in CI proves it.

Fix. Add these steps to the smoke-prod job, after the smoke script.

Runtime role check. Run a query as pos_admin with docker compose exec postgres psql. It must show:

every connection whose application_name or usename belongs to the api is pos_runtime;
pos_runtime has rolsuper = false and rolbypassrls = false;
pos_runtime owns no table in public. A table owner bypasses RLS unless FORCE RLS is set.
Print the result. Exit 1 on any failure.

Superuser refusal.

Start one extra api container with DATABASE_URL pointing at pos_admin, for example with docker compose run --rm -e DATABASE_URL=... api.
Expect a non-zero exit within 60 seconds.
Expect the log to contain the FATAL: Database connection user is a PostgreSQL superuser message.
Extend the startup check in prisma.service.ts so it also refuses either of these:

rolbypassrls = true;
the current user owns any table in public.
Add a unit test for each refusal. Mock $queryRaw.

5. Wrong commit in the Phase 1E "Problems found"
Section 8 of the Phase 1E report says the PROMOTION_CHANGED bug was "resolved in commit 78295ce".

That commit's CI failed (#114). Two more commits also failed: 3d61aa7 (#115) and 3083d88 (#116). The first green run after the fix is ff17aa8.

Fix. Rewrite the sentence along these lines:

the code fix is in 78295ce;
CI went green first at ff17aa8, with its run id from ci-status.cjs.
Run the validator on ## Phase 1E again.

Finish
Commit and push. Use one or two commits; the first one includes this note.
Check CI for that exact head_sha with ci-status.cjs. Do not start F2 until it says completed success.
If it fails, fix the real cause.
Do not skip, retry until it passes, or loosen a test.
In the final Phase 1F report, under "Problems found during the run", add one line per item above with its fixing commit.
Then continue with F2.
