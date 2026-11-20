# Prompt for Antigravity — Phase 1E, CI truth note (mid-run)
Copy everything below the line into Antigravity.

Finish your current commit, then do this before you continue Phase 1E. It is about 30 to 60 minutes. After that, go back to the plan where you left it. All Phase 1E rules still apply.

Save this text as docs/prompts/antigravity-pos-phase1e-ci-truth-note.md in your next commit. Log it under ### Mid-run note: CI truth inside ## Phase 1E in docs/overnight-log.md.

What review found
docs/overnight-log.md (Milestone E2 section) says:

CI Run 2: 44708483415 (Status: completed, Conclusion: success / Green)

That run is for 25e2aa0, and on GitHub it is #113, Status: Failure, 10m 0s, with one error annotation, "Process completed with exit code 1". So the real record since E1 is:

Commit	Run	Real result
e641606	44705513182 (#112)	failure
25e2aa0	44708483415 (#113)	failure (logged as success)
78295ce	44719703495 (#114)	failure
3d61aa7	#115	running at review time
This is the third run in a row where the log or report states something about CI that is not true. The run id was real this time. The conclusion was not. verify-report-refs.cjs only checks that a run exists, so it could not catch this.

Do this
1. Correct the log (docs only)
Change the 25e2aa0 line to the real conclusion.
Add the real cause of the #113 failure.
How to find the cause: read the run's annotations from the public API:
GET /repos/imovi/bangladesh-universal-pos-management-system/check-runs/<job id>/annotations
the job id comes from GET /actions/runs/44708483415/jobs.
If that does not tell you enough, check out 25e2aa0 in a temporary worktree and run the same CI steps locally against the _e2e database. That means the full Playwright suite, not only the promotion spec.
If you still cannot tell, write cause unknown, and say exactly what you tried. Do not guess a cause.
Then state plainly whether the #113 cause is fixed in the latest commit, not fixed, or unknown.
2. Make CI conclusions mechanical, never typed
Add scripts/ci-status.cjs <sha>. It:

calls https://api.github.com/repos/imovi/bangladesh-universal-pos-management-system/actions/runs?head_sha=<full sha> with no token;
prints one line per run: <run id> <short sha> <status> <conclusion>.
When the API returns a rate-limit message, it prints RATE_LIMITED and exits 2. It never prints a conclusion it did not read.

From now on, every CI line in the log and report is the script's output, pasted as it is. If the run is still in progress, or the API is rate limited, write exactly that. Wait and check again later. Never write success or Green from memory or from expectation.

3. Make the validator check conclusions too
Extend scripts/verify-report-refs.cjs:

For every 11-digit run id in the section, find the conclusion word written on the same line: success, failure, cancelled, Green or Red.
Compare it with the API's conclusion.
Exit 1 on any difference, and print the line.
Add a small test for this: a fixture section with one correct and one wrong conclusion. Mock the API response in the test, with no network. Run the validator on ## Phase 1E after step 1 and paste the output into the log.

4. Get back to green before E3
Do not start E3 until the latest commit has a run whose ci-status.cjs output says completed success.
If 3d61aa7 (#115) fails, fix the real cause first.
Do not skip, retry-until-pass, or loosen any test to get there. If you have to change a test, log the reason in one line per change.
5. One sentence in the log
Write one sentence on why a wrong conclusion was written, and what now stops it from happening again.

Final Phase 1E report
Under "Problems found during the run", add a line about this. Also check that the CI table in the final report comes only from ci-status.cjs output, and that verify-report-refs.cjs "Phase 1E" passes with the conclusion check on.
