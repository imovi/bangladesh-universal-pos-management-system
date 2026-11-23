Prompt for Antigravity — Phase 1F, follow-up fixes
Copy everything below the line into Antigravity.

Phase 1F is merged at 5b69cb0. Review found four problems. This is about 2 to 3 hours of work. Do it unattended, top to bottom, with no checkpoints.

All Phase 1F rules still apply:

no credentials and no real servers;
CI results only from scripts/ci-status.cjs output, pasted as it is;
report content built by script;
DB work only on _e2e, _test or _restore_check databases.
Save this text as docs/prompts/antigravity-pos-phase1f-followup-fix-prompt.md in your first commit. Log the work under a new ## Phase 1F, follow-up section in docs/overnight-log.md. Add the same section to docs/overnight-report.md at the end.

1. Nightly backups never run on a real server (fix first)
What review found.

deploy/docker-compose.prod.yml has no backup service.
scripts/backup.sh says it is "scheduled via cron", but nothing installs a cron entry.
docs/go-live/backup-restore.md says "via cron or on-demand", with no steps.
The owner hand-test list does not mention scheduling.
So an owner who follows deploy.md gets a running shop with no backups at all. The daily health banner would warn after 26 hours, but only if someone looks.

Fix. Add a backup service to deploy/docker-compose.prod.yml:

Image: a small image with pg_dump matching Postgres 17, age, rclone, bash and a cron runner, such as postgres:17-alpine plus those packages, built from deploy/backup/Dockerfile. Pin the versions.
Schedule: run backup.sh at 02:30 Asia/Dhaka. Set TZ=Asia/Dhaka in the container. Use supercronic or busybox crond; it must write to stdout.
Volumes and env: mount a named volume backups at the backup directory. Mount the same volume read-only into api if the Backups card reads the status file from there. Pass BACKUP_AGE_PUBLIC_KEY, BACKUP_RCLONE_REMOTE and the rclone config from env.
Connection: connect as pos_admin, the role that owns the tables, so the dump is complete. Never connect as pos_runtime.
Startup: depends on postgres being healthy. restart: unless-stopped.
First run: run one backup when the container starts, so a fresh install has a backup on day one and the Backups card is not empty.
Add deploy/backup/README lines to docs/go-live/backup-restore.md. Say how to check it worked: docker compose logs backup, and the Backups card on /settings.

Fix encryption so it never fails open. In backup.sh:

Case	What happens
BACKUP_AGE_PUBLIC_KEY is set, but age is missing or fails	Exit 1. Write no plain file and upload nothing. Write a status JSON with ok: false and a Bangla reason, so the banner shows it.
BACKUP_AGE_PUBLIC_KEY is not set	The backup is stored unencrypted on the server. rclone must refuse to upload an unencrypted file. Write the status as ok: true, with the warning ব্যাকআপ এনক্রিপ্ট করা নেই, তাই সার্ভারের বাইরে পাঠানো হয়নি.
Also:

Remove the || true after pg_dumpall --globals-only. If it fails, the backup fails.
Any failure in pg_dump, age, sha256sum or rclone exits non-zero, and the status file says so.
Tests.

Add a shell-level test, run in CI, that calls backup.sh four times against the _restore_check database:
no key: a plain file is written, and the status warns;
a key with age present: only a .age file exists, and no plain dump is left behind;
a key with age hidden from PATH: exit 1, no file, status ok: false;
a fake BACKUP_RCLONE_REMOTE with no key: rclone is never called, which you can check with a stub rclone on PATH that writes a marker file.
Retention: create 20 fake daily files and 10 fake weekly files with old dates. Run the prune step. Exactly 14 and 8 remain.
In smoke-prod:
after the stack is up, wait for the backup container's first run;
assert a backup file and a status file with ok: true exist in the backups volume;
assert GET /api/v1/settings/backups (or whatever the Backups card calls) returns that backup.
Add one line to the owner hand-test list: check docker compose logs backup the morning after the first night.

2. The log validator fails, and the log says it passes
What review found. node scripts/verify-report-refs.cjs "## Phase 1F" docs/overnight-log.md exits 1 at 5b69cb0, with 3 head SHA mismatches. The cause is the last three CI lines, which have no backticks around the hash:

- CI: efe3f6f → run 45064820984 → completed failure
- CI: ece8284 → run 45066688274 → completed success
- CI: c44190f → run 45068455767 → completed success
The validator output pasted in the log ("12 unique run IDs, all passed") was taken before those lines existed. The section now has 19 run ids.

Fix.

Make the validator accept a bare 7 to 40 character hex hash in the - CI: <sha> → run <id> → ... format. That is the format this project now requires, so it must parse it with or without backticks. Add a test fixture for the bare form.

Do not delete the earlier pasted output from the log. Below it, add:

a one-line note that it was taken at an earlier commit, naming which commit;
the fresh output from the final commit of this fix.
Add a CI step to the test job that runs the validator on every section in both files with --offline:

## Phase 1D, fixes;
## Phase 1D, fixes follow-up;
## Phase 1E;
## Phase 1F;
## Phase 1F, follow-up.
The --offline mode checks only format and pairing: every run line has a hash, every hash exists in git, and every run id is unique to one commit. It does not call the API, because CI runs would hit the rate limit. This stops a badly formatted line from being merged at all.

3. Unproven claim about the load check
What review found. The log line for c44190f says CI ran and verified load-check.mjs in "all scenarios". .github/workflows/ci.yml has no load-check step. The numbers in the report were measured on your machine only.

Fix.

Correct that log line, and section 5 of the Phase 1F report. Say plainly that the numbers come from one local run, and give the machine (CPU and RAM) if you know it.
Add a load-check job to CI that runs after test. It runs scripts/load-check.mjs with smaller settings, so the job finishes in under 8 minutes:
scenario 1: 10 registers for 2 minutes;
scenario 2: 300-sale sync burst;
scenario 3: the 30-day report on 50,000 seeded sales.
Keep the targets from the Phase 1F prompt. The script prints one JSON summary line per scenario, and the job fails if any target is missed.
Paste the CI job's own numbers into the report next to the local ones, labelled CI (ubuntu-latest).

4. The 5,000-row import is slow, and its test leaves data behind
What review found. On the reviewer's laptop, the test previews and commits a 5,000-row synthetic product CSV in under 60 seconds in apps/api/test/import-engine.spec.ts timed out at 60,024 ms.

The test also signs up a tenant with a fixed slug and does not delete it on failure. So the next run of the whole file fails in beforeAll with SLUG_ALREADY_EXISTS, and all 12 tests are skipped.

Fix the test isolation.

Use a unique slug per run, for example with a random suffix.
Delete the test tenant in afterAll with the system connection, even when a test failed.
Run the file twice in a row and paste both summaries into the log.
Make the import faster.

Profile the 5,000-row commit. Write down where the time goes, per step: parse, validate, lookups, inserts, stock movements and audit. Put this in the log.
Then fix the biggest cost. Likely candidates:
one query per row for category, brand, collection or existing SKU lookups — load them once into maps;
variant inserts one by one — use createMany in chunks of 500;
stock movements and audit rows one by one — batch them as well.
Keep one transaction per file, and keep every existing import test green.
Targets.

The 5,000-row preview plus commit takes under 20 seconds on CI. Log the measured time.
Keep the test's own timeout at 60 seconds, so there is headroom for slower machines.
Add one more test: 20,000 rows, preview only, under 30 seconds. This is the stated maximum.

5. One question for the log (no code)
The report says F4 was resumed after BLOCKED "following human direction". Write down exactly what that direction was and when it came:

quote the message if you have it;
if there was none, say so plainly.
The rule is that 3 failed attempts means BLOCKED and you stop. Resuming without a human message breaks it.

Finish
Commit and push. Check each commit's CI with ci-status.cjs on its exact head_sha.
Fix real causes only. Never skip, retry until it passes, or loosen a test.
Three failed attempts on one item means that item is BLOCKED. Log it and move to the next item.
When the last commit is green, run the validator on all five sections, online, and paste the outputs.
Write the ## Phase 1F, follow-up report section. It contains:
a table of commit → run → conclusion, from script output;
one line per problem above, with its fixing commit;
the CI and local load numbers side by side;
the import timing before and after;
an updated owner hand-test list.
Stop. Do not start Phase 3.
