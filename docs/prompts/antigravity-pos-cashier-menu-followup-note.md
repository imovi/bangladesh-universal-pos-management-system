Prompt for Antigravity — cashier menu follow-up
Copy everything below the line into Antigravity.

Review accepted the main fix in 5c687c7. The cause is the ShiftInUseAlert overlay catching the click, and the test now closes that dialog before it opens the cashier menu.

CI for bf0d04a (run 45667136161) is green:

test shows 161 passed (8.5m);
smoke-prod shows restarts=0;
load-check shows salesCount 50000/50000.
Review found four things to fix. This is about 1 hour of work. Do it unattended, top to bottom.

All rules still apply:

CI results only from scripts/ci-status.cjs output, or from the public jobs and annotations API, pasted as they are;
each CI line in the form - CI: `<sha>` → run `<id>` → <status> <conclusion>;
never skip, add retries, fixme, or a longer blind timeout;
every number and output block must be copied from real command output. Paste JSON and test summaries as they are printed. Do not retell them in your own words;
wait about 12 minutes after a push, then check at most once every 5 minutes;
never delete or rewrite earlier lines in docs/overnight-log.md. Only add new lines at the end.
Save this text as docs/prompts/antigravity-pos-cashier-menu-followup-note.md in your first commit. Log the work under ### Follow-up inside ## Flaky cashier menu note at the end of docs/overnight-log.md.

Before each commit, run git status, and add files by name. Never use git add . or git add -A. Do not commit the screenshots under docs/screenshots/ that the test run changes. Restore them with git restore docs/screenshots before each commit.

1. Remove the hydration code
Your own log says hydration is not the cause. The cashier button is not in the server HTML, because /pos shows a spinner while isAuthLoading is true. Also, login reaches /pos through router.push, which is client navigation. So by the time the button first renders, isMounted is already true. The code never does anything.

The last note said: "Do not fix a cause you have not shown." So:

In apps/admin/src/app/pos/page.tsx, remove:

the isMounted state and its useEffect;
data-hydrated on the POS root;
disabled={!isMounted} and disabled:opacity-50 disabled:pointer-events-none on cashier-name-block.
Keep data-testid="pos-root" only if a test still uses it.

In apps/admin/e2e/pos-flow.spec.ts and apps/admin/e2e/settings-flow.spec.ts, remove the waits for data-hydrated="true". The toBeVisible() and toBeEnabled() checks before the click can stay.

Remove the CPU_THROTTLE and CDP code from pos-flow.spec.ts. It started throttling only after /pos had loaded, and its catch {} hid any error. So it did not prove anything. If you want a throttle option for later, put it in a Playwright fixture that starts before page.goto("/login") and fails loudly when CDP fails. That is optional.

In docs/overnight-report.md, problem line 12: remove the hydration part. The fix is "handle the shift-in-use dialog before clicking the cashier menu", plus whatever section 3 below finds.

2. Restore the deleted log line
bf0d04a deleted this line from docs/overnight-log.md:

GitHub token support tooling task closed at [`a8104aa`](https://github.com/imovi/bangladesh-universal-pos-management-system/commit/a8104aa), run [45603278701](https://github.com/imovi/bangladesh-universal-pos-management-system/actions/runs/45603278701), all three jobs success.
Put it back exactly where it was, just before ## Flaky cashier menu note. Then run git diff 824f303 -- docs/overnight-log.md and paste the lines starting with -, if there are any. Only whitespace may be removed. Nothing else.

3. Why the shift was open at all
pos-flow.spec.ts closes every open shift in beforeAll through cleanupLingeringShifts. If that worked, ShiftInUseAlert would never show in Flow 1. So the cleanup fails somewhere, and nobody sees it:

catch {} swallows every error;
.catch(() => {}) on each close hides failed closes;
the close response status is never checked;
the list call /shifts?status=open may return only the first page.
Do this:

Make the cleanup loud.

Check loginRes.ok(), shiftsRes.ok() and every close response.
On any non-2xx status, throw an error with the status and the response body. Do not print tokens.
Remove the catch {} and the .catch(() => {}). If the API is not running, the test should fail anyway.
Run the whole E2E suite locally once with retries: 0. Paste:

the cleanup error, if any;
how many open shifts the cleanup found and closed in that run.
Find why the close failed and fix it. Possible causes:

the API needs overrideReason (MANAGER_OVERRIDE_REQUIRED, shifts.service.ts around line 133);
the body field is wrong;
the list is paged;
the shift is opened after beforeAll runs, for example by a test in the same file.
Paste the response body that shows the cause, and the lines you changed.

If the cleanup works and the dialog still shows, find who opens the shift. Use git grep -n "shifts/open\|open-shift-button" apps/admin/e2e, and write down which test and which user. Fix that test, so it closes its own shift.

Keep the dialog handling in Flow 1. A real cashier can meet that dialog too. But the test must not depend on it to pass.

4. Correct the log
Under ### Follow-up, add:

The reproduced error is not the CI error.

Your local reproduction failed at line 67 with locator.click: Test timeout ... intercepts pointer events.
CI failed at line 68 with toBeVisible(). That means the click went through but the menu did not open.
Write one or two sentences on how the overlay explains the CI failure, for example that it appeared between Playwright's hit check and the click. Or write that it is not fully explained.
Also say how you set up the reproduction: which shift you left open, and the exact command.
The CI line for bf0d04a, which is missing:

- CI: `bf0d04a` → run `45667136161` → completed success
Then write that 5c687c7 has no own run, because both commits were pushed together.

In the report table, fill the run column of the 5c687c7 row with run 45667136161 (SUCCESS, on bf0d04a). Add rows for the new commits of this note.

5. Proof
Run e2e/pos-flow.spec.ts with --repeat-each=20 and retries: 0. Paste the summary. It must be 0 failed.
Run the whole E2E suite 3 times in a row locally with retries: 0. Paste the 3 summaries as printed.
Run git grep -n "isMounted\|data-hydrated\|CPU_THROTTLE" apps/admin and paste the result. It must be empty, unless you added the optional fixture from section 1.
Commit and push. Check every commit with ci-status.cjs on its exact head_sha. The last commit, including a docs-only one, must be green.
For the final commit, paste:
one line per job from the jobs API: test, smoke-prod and load-check, all success;
the Playwright Run Summary annotation of the test job, as printed.
Run the validator online on ## Flaky cashier menu note in docs/overnight-log.md, and on ## Phase 1F, follow-up in docs/overnight-report.md. Paste both outputs.
If CI fails, read the annotation, fix the cause and log it. Three failed fix attempts on one test means BLOCKED: log it with the run URLs and the test name.
Then stop. Do not start Phase 3.
