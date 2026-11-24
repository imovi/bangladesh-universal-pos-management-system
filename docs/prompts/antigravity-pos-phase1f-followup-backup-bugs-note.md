Prompt for Antigravity — Phase 1F follow-up, backup bugs note
Copy everything below the line into Antigravity.

Stop what you are doing after your current commit. Then do this note top to bottom, unattended. It is about 2 to 3 hours of work.

All Phase 1F follow-up rules still apply:

no credentials and no real servers;
CI results only from scripts/ci-status.cjs output, or from the public jobs API, pasted as they are;
each CI line in the form - CI: `<sha>` → run `<id>` → <status> <conclusion>;
never skip, retry until it passes, or loosen a test;
three failed attempts on one item means BLOCKED: log it with the run URLs and move to the next item.
Save this text as docs/prompts/antigravity-pos-phase1f-followup-backup-bugs-note.md in your first commit. Log the work under ### Backup bugs note inside ## Phase 1F, follow-up in docs/overnight-log.md.

What review found
The last five runs are all red:

Commit	Run	Result
c14b959	45253851408	failure: E2E data import
c38f2bc	45259127727	failure: test and load-check passed, smoke-prod failed at "Run production smoke test"
f53e3ea	45262493871	failure: test failed at "Run Admin Dashboard E2E tests", so smoke-prod and load-check were skipped
The log has:

no CI lines for c38f2bc or f53e3ea;
no BLOCKED entry;
no report section.
Review built the production stack locally from f53e3ea with deploy/docker-compose.prod.yml and ran scripts/smoke-prod.mjs.

Steps 1 to 7 pass.
Step 8 fails exactly as in CI.
The cause is the two real bugs below. Neither is a CI problem.
1. The Backups API refuses the real Owner (fix first)
What review found. apps/api/src/modules/tenants/settings.controller.ts, line 28, added in F2 commit 2f80b82:

if (req.user.roleName !== SYSTEM_ROLES.OWNER) {
  throw new ForbiddenException("Only Owner can view backup status");
}
req.user has no roleName field. auth.service.ts puts the roles in an array, roles: roleNames. So req.user.roleName is always undefined, and every caller gets 403, including the Owner.

As a result:

the Backups card on /settings has never worked since F2;
smoke step 8 never sees a backup;
no test caught it. The card was never tested against a real Owner token.
Review ran a copy of the smoke script that prints errors and saw 15 × HTTP 403 Only Owner can view backup status. This is the only use of roleName on req.user in apps/, but check again after your change.

Fix.

Check the role the same way the rest of the API does.
If the project has a permission guard or decorator (for example a settings.backups.view permission), use it.
Otherwise check req.user.roles?.includes(SYSTEM_ROLES.OWNER).
Use one approach, matching the other Owner-only endpoints.
Type req.user properly, so that a field that does not exist, like roleName, fails the TypeScript build. Find where the request user type is declared, or add one, and use it in this controller. any must not reach this check.
Search all of apps/api/src for other checks on fields that the JWT payload does not carry. Fix any you find, and list them in the log.
Tests.

API e2e, real login, no mocks:
the Owner gets 200 from GET /api/v1/settings/backups;
a Cashier gets 403;
a request with no token gets 401.
Admin E2E: log in as Owner, open /settings, and assert that the Backups card shows its content (or its empty state), not an error.
Run both before the fix and paste the failing lines into the log. They must fail on f53e3ea and pass after.
2. The backup container is in a crash loop
What review found. In deploy/backup/entrypoint.sh, lines 36 to 40:

mkdir -p /var/spool/cron/crontabs /etc/crontabs
cat <<'EOF' > /var/spool/cron/crontabs/root
30 2 * * * /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1
EOF
cp /var/spool/cron/crontabs/root /etc/crontabs/root
In postgres:17-alpine, /var/spool/cron/crontabs is a symlink to /etc/crontabs. cp fails with are the same file. set -euo pipefail then ends the script with exit 1.

Review saw the container in Restarting (1) with that error in docker compose logs backup. The effects:

crond never starts, so the 02:30 backup never runs;
restart: unless-stopped starts it again, and each start runs the "first run" backup. That is a new full backup about every 4 seconds, loading the database and filling the volume;
smoke tests cannot see this, because the first backup itself does complete.
Fix.

Write the crontab once, to /etc/crontabs/root only. Remove the cp. Do not depend on whether the spool directory is a symlink.
Make the first-run backup run once per container start, and make its failure visible without killing the container:
if the first backup fails, log it and write the ok: false status, as backup.sh already does;
still start crond, so the nightly run keeps trying.
Run crond in the foreground as PID 1 with logs to stdout (for example exec crond -f -l 2).
Add a container healthcheck that fails when crond is not running.
Tests.

In the smoke-prod CI job, after the smoke script:

wait 90 seconds;
read docker inspect for the backup container;
assert State.Status is running, RestartCount is 0, and health is healthy;
assert docker compose exec backup pgrep crond finds it;
assert the daily/ folder in the backups volume holds exactly one backup file. More than one means a restart loop.
Print each value and exit 1 on any failure.

Run the same check locally with the production compose file. Paste its output into the log.

Cron test. Add a test that proves the schedule fires:

start the backup container with an override schedule of every minute. Make the schedule an env var, BACKUP_CRON, defaulting to 30 2 * * *;
wait about 75 seconds;
assert a second backup and a fresh status file appear.
This can run locally only if CI time is tight. Say which in the log.

3. Smoke step 8 hides the real error
What review found. In scripts/smoke-prod.mjs, step 8:

the retry loop swallows every error, so a 403 shows only as Backup service did not complete initial backup within 30 seconds;
it prints the same object twice, as BACKUP_STATUS_JSON and BACKUPS_API_RESPONSE.
Fix.

Keep the last error from the loop, with HTTP status and body. On timeout, print it.
Fail at once on 401 or 403, without retrying. Those are not "still waiting".
Print two different things:
BACKUP_STATUS_JSON: the status file read from the volume;
BACKUPS_API_RESPONSE: the API body.
Assert that the newest backup in the API response has the same file name as the one in the status file.
4. Find the real cause of the E2E failure in #153
Run 45262493871 failed at "Run Admin Dashboard E2E tests". f53e3ea only changed backup.sh, test-backup.sh, smoke-prod.mjs and the log. So either a test is flaky, or something else broke it.

Download the run's Playwright report or log artifact, or rerun the same spec locally with the same seed. Name the failing test and paste its error.

Then do one of these:

Real bug: fix it in the code.
Flaky test (timing, order, shared data): fix the test's cause, for example wait for a specific response instead of a timeout, or use unique data per test. Then run that spec 5 times in a row locally and paste the 5 results.
Cause unknown: write cause unknown, what you tried, and the error text. Do not guess.
Never mark it skip, fixme, or add retries.

Also look at c14b959 (run 45253851408). The log says its E2E data-import failure was fixed. Confirm that the same test passed in a later run and name that run.

5. The BLOCKED rule and the log
Three commits in a row failed after the CI fix note, and the log says nothing about them.

Add the missing CI lines, from ci-status.cjs output, for c38f2bc, f53e3ea and every new commit.
For each red run, add one line saying which job failed and the cause you now know.
Write one sentence on why you did not stop with BLOCKED after the third red run. If the failures had different causes, say so. If you simply kept going, say that plainly.
Finish
Commit and push. Check every commit with ci-status.cjs on its exact head_sha. For the final commit, use the jobs API to paste one line per job. All three must be success:

test;
smoke-prod;
load-check.
From the green smoke-prod job's own output, paste:

the line showing the first backup finished;
BACKUP_STATUS_JSON with ok: true;
BACKUPS_API_RESPONSE showing the same file;
the container check from item 2: running, RestartCount 0, healthy, crond found, one file in daily/.
Paste the load-check job's three JSON summary lines.

Run the validator online on all five sections and paste all five outputs:

## Phase 1D, fixes;
## Phase 1D, fixes follow-up;
## Phase 1E;
## Phase 1F;
## Phase 1F, follow-up.
If the API is rate limited, wait and try again. Never write a result you did not read.

Write ## Phase 1F, follow-up at the end of docs/overnight-report.md. It contains everything the follow-up prompt and the CI fix note asked for:

the commit → run → conclusion table, from script output, including every red run;
one line per problem, with its fixing commit. Cover the 5 follow-up problems, the CI fix note's Case 3 PATH bug, and the 4 items in this note;
the load numbers in two columns, Local (i7-11800H, 16 GB) and CI (ubuntu-latest);
the import time before and after: 60.02 s → about 4.5 s for 5,000 rows, and the 20,000-row preview;
"Problems found during the run". Include both bugs from this note, and say plainly that the Backups card did not work from F2 until this fix;
the updated owner hand-test list. It must include:
open /settings as Owner and see the Backups card with a backup;
the morning after the first night, check docker compose logs backup for the 02:30 run;
check docker compose ps shows the backup container Up (healthy), not Restarting.
Then stop. Do not start Phase 3.
