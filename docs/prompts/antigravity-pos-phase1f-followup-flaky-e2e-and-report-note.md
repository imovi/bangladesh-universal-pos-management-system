Prompt for Antigravity — Phase 1F follow-up, flaky E2E and report truth note
Copy everything below the line into Antigravity.

The empty backup fix works. Review checked it on a fresh volume:

backup now starts after migrate;
the first dump has 54 tables;
the container shows 0 restarts.
Three things are still wrong. This is about 60 to 90 minutes of work. Do it unattended, top to bottom.

All Phase 1F follow-up rules still apply:

CI results only from scripts/ci-status.cjs output, or from the public jobs API, pasted as they are;
each CI line in the form - CI: `<sha>` → run `<id>` → <status> <conclusion>;
never skip, retry until it passes, or loosen a test;
every number and every output block in the log and report must be copied from a real command output. Never type, round, merge or "clean up" output. If you do not have it, write not measured.
Save this text as docs/prompts/antigravity-pos-phase1f-followup-flaky-e2e-and-report-note.md in your first commit. Log the work under ### Flaky E2E and report note inside ## Phase 1F, follow-up in docs/overnight-log.md.

1. HEAD is red: an E2E test is still flaky (fix first)
What review found.

ed0b471 changed only docs/overnight-log.md and docs/overnight-report.md.
Its run 45357012655 still failed: the test job failed at step 20, "Run Admin Dashboard E2E tests", and smoke-prod and load-check were skipped.
3711d03, one commit before with the same code, passed.
So some E2E spec passes or fails by chance. The import spec passed 5 times in a row locally, so it is probably a different spec.

Do this.

Find the failing test. Read the job log, or download the Playwright report artifact from run 45357012655. Paste:
the spec file and test name;
the error;
the 10 lines of the stack nearest the failure.
Find the cause. Look for:
a fixed waitForTimeout;
isVisible({ timeout }), which does not wait;
shared data between tests, for example the same SKU, the same register, or an open shift left from another spec;
tests that depend on run order.
Fix the cause in the test or in the app. Never add retries, skip, fixme, or a longer blind timeout.
Search the whole apps/admin/e2e folder for isVisible({ timeout and waitForTimeout(. Fix each one that is used to wait for something, the same way as in the import spec. List every file you changed.
Proof.
Run the failing spec with --repeat-each=10 locally and paste the summary.
Then run the whole E2E suite 3 times in a row locally and paste the 3 summaries.
If any run fails, keep fixing. Three failed fix attempts on this item means BLOCKED: log it with the run URLs and move to item 2.
2. The load numbers must come from real output
What review found.

This line, logged as the CI output for 81998d7, cannot be real script output:

{"scenario":1,...,"durationSec":120,"throughputReqSec":16.7,...,"totalSales":200,...}
scripts/load-check.mjs computes throughputReqSec as totalSales / durationSec, and 200 / 120 is 1.7, not 16.7.

The report table still shows CI scenario 1 as 12.0 s, 16.7 req/s and 200 sales. The real CI line for 3711d03, in the log, is:

{"scenario":1,...,"durationSec":16.7,"throughputReqSec":3.6,...,"totalSales":60,...}
The "Measurement Note" in the report describes modes, a "batch mode" and a "soak mode", that the CI job does not run.

The follow-up fix prompt asked for scenario 1 in CI to run 10 registers for 2 minutes. It now runs about 17 seconds.

Do this.

In the log, under the 81998d7 proof, add a note directly below the scenario 1 line:

say that this line does not match the script's own formula;
say where it came from: copied from the job, typed, or edited.
Do not delete the line. Then paste the real line from that job's output if you can get it. If you cannot, write real output not available.

Make CI scenario 1 run what was asked:

10 registers for 2 minutes. Set the duration by env or a flag in the load-check job, and keep the job under 8 minutes;
the JSON line must report the measured elapsed time in durationSec, not the configured one.
Rebuild the report's load table only from two pasted JSON lines per scenario:

the local run;
the final green CI run.
Each cell must be readable straight from those lines. Paste the six source lines (3 scenarios × 2 machines) directly above the table.

Delete the "Measurement Note", or rewrite it so it describes only what the script really does, using its variable names.

Write one sentence in "Problems found during the run" saying the earlier load numbers in this section did not match the script output, and which commit corrects them.

3. Remove the restore claim that has no commit
"Problems found during the run", item 4, says "Non-Interactive Restore Fails on Empty Database" was fixed in c5ec4e1 by updating scripts/restore.sh. But git show --stat c5ec4e1 does not list scripts/restore.sh.

Run git log --oneline -- scripts/restore.sh and paste the output into the log.
Then do one of these:
A commit in this follow-up really changed it, and you can name the review item it answered: fix the commit hash in the report.
No such commit exists: delete the item from the report, and write one line in the log saying it was removed and why.
Do the same check for item 5, "Report Numbers from Dev Workstation": name the commit that changed the hardware text, with git log -S"i7-11800H" -- docs/overnight-report.md. Keep the item only if a commit is found.
Finish
Commit and push. Check every commit with ci-status.cjs on its exact head_sha. The last commit, including a docs-only one, must be green. If a docs-only commit turns red, that is item 1 again, not bad luck.
For the final commit, paste one line per job from the jobs API. All three must be success: test, smoke-prod and load-check.
Paste the load-check job's three JSON lines from that final run, as printed.
Run the validator online on all five sections in both files, and paste the outputs:
## Phase 1D, fixes;
## Phase 1D, fixes follow-up;
## Phase 1E;
## Phase 1F;
## Phase 1F, follow-up.
Add the new commits and runs to the report's table, red ones included.
Then stop. Do not start Phase 3.
