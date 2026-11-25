Prompt for Antigravity — Phase 1F, final fix note
Copy everything below the line into Antigravity.

Phase 1F is green at 79273b3 (run 45498646906). Review accepted the notice annotations, the Playwright github reporter and the 10 validator outputs. The last three runs show 161 passed with no flaky tests.

Review found one real bug in the load script and several wrong statements in the log and report. This is about 60 to 90 minutes of work. Do it unattended, top to bottom.

All Phase 1F follow-up rules still apply:

CI results only from scripts/ci-status.cjs output, or from the public jobs and annotations API, pasted as they are;
each CI line in the form - CI: `<sha>` → run `<id>` → <status> <conclusion>;
never skip, retry until it passes, or loosen a test;
every number and output block must be copied from real command output. If you do not have it, write not measured.
Save this text as docs/prompts/antigravity-pos-phase1f-final-fix-note.md in your first commit. Log the work under ### Final fix note inside ## Phase 1F, follow-up in docs/overnight-log.md.

Before each commit, run git status, and add files by name. Never use git add . or git add -A.

1. Scenario 3 counts the wrong days (fix first)
What review found.

CI scenario 3 reports "salesCount":48333 in both run 45471519979 and run 45491700742. The local run reports 50000.
scripts/load-check.mjs seeds 50,000 sales spread over 30 days, (idx % 30) days back from now. So 1/30 of them, about 1,667, are dated "now".
The script builds startDate and endDate with new Date(...).toISOString().split("T")[0]. That is the UTC date.
The API reads those dates in the tenant time zone, Asia/Dhaka, through parseDateFilterRange in packages/shared/src/timezone.ts. endDate becomes 23:59:59 Dhaka time.
Both CI runs ran between 18:00 and 24:00 UTC, which is after midnight in Dhaka. The UTC date was one day behind the Dhaka date. So endDate ended the day before, and the ~1,667 sales dated "now" fell outside the range. 50,000 − 1,667 = 48,333.
The API is right. The script is wrong.

Fix.

In scripts/load-check.mjs, build startDate and endDate as business dates in the tenant time zone. Use formatBusinessDate from @universal-pos/shared with Asia/Dhaka, or the tenant's own time zone if the script has it. The range must hold all seeded sales, whatever time of day the script runs.

Remove both fake fallbacks:

the ?? 50000 in aggregatedSalesCount;
the ?? "50,000+" in the Sales in Range (DB) log line.
If the API response has no salesCount, scenario 3 must fail with a clear message.

Make the count part of the pass rule. Scenario 3 passes only if salesCount equals the number of sales seeded and the time budget is met. Print the expected count in the JSON as expectedSalesCount.

Proof.

Run scenario 3 locally once with the machine clock in UTC (for example TZ=UTC) and once in Asia/Dhaka. Paste both JSON lines; both must show 50000.
If you can, also run it with a fake now between 18:00 and 24:00 UTC. If not, say so.
Paste the CI scenario 3 line from the final run's annotations.
2. restarts= is empty in the smoke-prod annotation
In .github/workflows/ci.yml, line 304 prints restarts=$RESTARTS. The variable is set on line 262 as RESTART_COUNT. So the annotation always reads restarts=.

Fix the name. Then paste the smoke-prod annotation line from the final run. It must show restarts=0.

3. The two red runs: the log gives the wrong cause
What review found.

0e0f1db (run 45479302711) and 91d472f (run 45488323826) both failed in the test job, step 20 "Run Admin Dashboard E2E tests".
The log calls both "intermittent E2E runner timeout". But the test job has no timeout-minutes, and the step ran 9m43s and 8m58s. The public annotation for both jobs is only Process completed with exit code 1.. That means Playwright reported a failing test. It was not a timeout.
The log also says next build rebuilds apps/admin/public/sw.js in CI, so the committed file does not affect CI. Then eb5070e puts the file back in git because of these two red runs. Both statements cannot be true. The three green runs after it do not prove the file mattered.
Do this.

In the log, under both red runs, replace "intermittent E2E runner timeout" with what is known: the step failed with exit code 1; the failing test is not known, because the github reporter was not yet on; no timeout is configured.
Try to find the failing test. Download the playwright-report artifact of run 45479302711 or 45488323826 if it is still there. If you find it, paste the spec, the test name and the error. If not, write cause unknown and what you tried.
Decide on apps/admin/public/sw.js, based on facts only:
If next build in CI writes the file (check by printing ls -l apps/admin/public/sw.js and its first 200 bytes after "Build packages" in a CI run, or by building locally from a clean checkout without the file), untrack it again with .gitignore and git rm --cached, and say in the log that re-tracking it in eb5070e was not needed.
If it does not, keep it tracked, and correct the earlier log line that says the build rewrites it.
4. CI retries hide flaky tests
apps/admin/playwright.config.ts has had retries: process.env.CI ? 2 : 0 since 4e1a6b6. In CI, a failing test is run up to three times, and the job is green if one try passes. So a flaky test only shows when it fails three times in a row.

Set retries to 0 in CI too.
Run the full E2E suite 3 times in a row locally and paste the 3 summaries.
If CI turns red after this change, the github reporter now names the failing test in the annotations. Read it from the public annotations API, fix the cause in the test or the app, and log it. Do not put the retries back. Three failed fix attempts on one test means BLOCKED: log it with the run URLs and the test name.
5. Report corrections
In docs/overnight-report.md, ## Phase 1F, follow-up:

Rebuild the scenario 3 rows of the load table from the new local and CI JSON lines. Replace the old scenario 3 source lines above the table with the new ones, and update the run and job id.

The "Sales Count Aggregated" row's Result column must follow the real count. A count under the target must never show PASSED.

In "Problems found during the run", add one line each:

the scenario 3 UTC date bug, with its fixing commit;
the empty restarts= annotation, with its fixing commit;
the CI retries: 2 setting, and what turning it off showed.
Replace the closing line at the end of the section with the final commit of this note:

Phase 1F closed at `<final sha>`, run `<run id>`, all three jobs success.
The sha must be the last commit you push, and its run must be green.

Finish
Commit and push. Check every commit with ci-status.cjs on its exact head_sha. The last commit must be green, including a docs-only one.
For the final commit, paste:
one line per job from the jobs API: test, smoke-prod and load-check, all success;
the Playwright Run Summary annotation from the test job;
the three load-check annotation lines and the smoke-prod annotation lines.
Add the new commits and runs to the report's table, red ones included.
Run the validator online on ## Phase 1F, follow-up in both files and paste both outputs.
Then stop. Do not start Phase 3.
