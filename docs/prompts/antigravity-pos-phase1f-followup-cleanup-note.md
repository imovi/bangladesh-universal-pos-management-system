Prompt for Antigravity — Phase 1F follow-up, cleanup note
Copy everything below the line into Antigravity.

Phase 1F follow-up is green at 1c960b0. Review accepted the flaky E2E fix, the 2-minute load check and the report corrections. This is the last cleanup before Phase 1F closes. It is about 30 to 45 minutes of work. Do it unattended, top to bottom.

All Phase 1F follow-up rules still apply:

CI results only from scripts/ci-status.cjs output, or from the public jobs API, pasted as they are;
each CI line in the form - CI: `<sha>` → run `<id>` → <status> <conclusion>;
never skip, retry until it passes, or loosen a test;
every number in the log and report must be copied from real command output. If you do not have it, write not measured.
Save this text as docs/prompts/antigravity-pos-phase1f-followup-cleanup-note.md in your first commit. Log the work under ### Cleanup note inside ## Phase 1F, follow-up in docs/overnight-log.md.

Do not commit screenshots or build output that changed only because tests ran. Before each commit, run git status, and add files by name. Never use git add . or git add -A.

1. Make CI numbers readable without signing in
What review found. The CI column of the load table says not measured, because job logs need a GitHub sign-in. But annotations are public. Review reads them with:

GET /repos/imovi/bangladesh-universal-pos-management-system/check-runs/<job id>/annotations
That call needs no token.

Fix.

In scripts/load-check.mjs, when GITHUB_ACTIONS is true, print each scenario's JSON summary line a second time, as a notice annotation:

::notice title=load-check scenario <n>::<the same JSON line>
Keep the normal JSON line too. Print the exact same string in both places.

In the smoke-prod job, do the same for the proof lines:

BACKUP_STATUS_JSON, on one line;
the container stability result: status, restart count, health, crond found, dump count;
the core-table check: TABLE DATA count and the three table names found.
Use title=smoke-prod backup.

GitHub keeps at most 10 notice annotations per step. Keep under that limit.

Push. Then read the annotations for the load-check and smoke-prod jobs of that run with the public API, using curl with no token. Paste the raw response lines into the log.

2. Fill the CI column from those annotations
In docs/overnight-report.md, under "Raw Script JSON Output Lines", replace the real output not available block with:
the three CI JSON lines, copied from the annotations;
the run id and job id they came from.
Fill the CI Runner column of the load table from those lines only.
Any row the JSON lines do not contain stays not measured in both columns. That includes:
Scenario 3, "Sales Count Aggregated": the JSON has no count, so 50,000 records must become not measured. Or add a salesCount field to the scenario 3 JSON, and then fill both columns from it.
Scenario 2, latency average and p95: the same rule applies.
The "Result" column: a row whose target is missed must not say PASSED.
Scenario 1 "Total Duration" has the target < 120s, but it is a 2-minute soak, so 120.9 s is expected. Change that row's target to —, and write the real limit from the script in one line under the table.
Check every other row the same way.
3. Correct the service worker cause in the log
The log says public/sw.js "lacked" clientsClaim: true and skipWaiting: true. But apps/admin/src/app/sw.ts has had both since 6272c90. public/sw.js is the build output of that file.

Run git diff 1c960b0~2 e3234f9 -- apps/admin/public/sw.js | head -c 2000 and look at what really changed. Write one or two plain lines in the log saying what the change was. For example: the committed file was a stale build and was rebuilt.
Say that the fix for the failing test is in offline-selling.spec.ts: it waits for the service worker controller and the /pos cache entry instead of a fixed 1 second.
Check whether next build writes public/sw.js again in CI.
If it does, the committed file does not affect CI. Say so.
Add apps/admin/public/sw.js to .gitignore and remove it from git with git rm --cached, but only if the admin build and E2E still pass without the committed file. Run both and paste the summaries.
If they do not pass, leave the file in git and write why.
4. Validator outputs
When the last commit is green, run the validator online on all five sections in both files. Paste all ten outputs into this section of the log:

## Phase 1D, fixes;
## Phase 1D, fixes follow-up;
## Phase 1E;
## Phase 1F;
## Phase 1F, follow-up.
If the API is rate limited, wait and try again. Never write a result you did not read.

Finish
Commit and push. Check every commit with ci-status.cjs on its exact head_sha. The last commit must be green, including a docs-only one.

For the final commit, paste one line per job from the jobs API: test, smoke-prod and load-check, all success.

Add the new commits and runs to the report's table.

Add one closing line at the end of ## Phase 1F, follow-up in the report:

Phase 1F closed at `<final sha>`, run `<run id>`, all three jobs success.
Then stop. Do not start Phase 3.
