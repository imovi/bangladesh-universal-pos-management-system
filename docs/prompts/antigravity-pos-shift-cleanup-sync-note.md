Prompt for Antigravity — shift cleanup sync
Copy everything below the line into Antigravity.

The reviewer pushed one commit on top of your work. Pull it before you do anything else:

git pull --ff-only
You should now have a6b78f6 ("fix(e2e): share one loud shift cleanup helper across specs"). CI for it (run 45767075990) is green:

test: 161 passed (9.6m);
smoke-prod: restarts=0;
load-check: scenario 3 salesCount 50000/50000.
This is about 1 hour of work. Do it unattended, top to bottom.

All rules still apply:

CI results only from scripts/ci-status.cjs output, or from the public jobs and annotations API, pasted as they are;
each CI line in the form - CI: `<sha>` → run `<id>` → <status> <conclusion>;
never skip, add retries, fixme, or a longer blind timeout;
every number and output block must be copied from real command output;
wait about 12 minutes after a push, then check at most once every 5 minutes;
never delete or rewrite earlier lines in docs/overnight-log.md. Only add new lines at the end;
add files by name. Never use git add . or git add -A. Restore docs/screenshots with git restore docs/screenshots before each commit.
Save this text as docs/prompts/antigravity-pos-shift-cleanup-sync-note.md in your first commit. Log the work under ### Shift cleanup sync at the end of docs/overnight-log.md.

1. What changed in a6b78f6
Read it with git show a6b78f6 --stat and git show a6b78f6 -- apps/admin/e2e/helpers/shift-cleanup.ts.

There is now one helper: closeAllOpenShifts(request) in apps/admin/e2e/helpers/shift-cleanup.ts. It logs in as the owner, lists open shifts, closes each one, and throws on any non-2xx response with the status and the body. It returns how many shifts it closed.
12 specs now call it in afterAll. pos-flow.spec.ts also calls it in beforeAll. The old inline cleanup code with catch {} and .catch(() => {}) is gone.
coupons-pos-flow and promotions-pos-flow were not changed. Their afterAll ends a promotion, not a shift.
Rules from now on:

Do not bring back any inline shift cleanup. Any new spec that opens a shift must call closeAllOpenShifts(request) in afterAll.
Never wrap that call in try/catch. If it fails, the test must fail.
Keep the dialog handling for ShiftInUseAlert in Flow 1, but a test must not depend on it to pass.
2. Log the CI result
Under ### Shift cleanup sync, add:

The CI line for a6b78f6:

- CI: `a6b78f6` → run `45767075990` → completed success
Check it yourself with ci-status.cjs first, and paste its output as printed.

One sentence: "a6b78f6 replaced the 12 copies of the shift cleanup with one helper that fails loudly."

One sentence: "Why ShiftInUseAlert appeared in CI run 45598833108 is still not proven."

In docs/overnight-report.md, add a row for a6b78f6 to the table in ## Phase 1F, follow-up, with run 45767075990 and SUCCESS.

3. Find who leaves a shift open (read only, no fix unless proven)
Run the whole E2E suite locally once with retries: 0.
Temporarily print the return value of closeAllOpenShifts in each afterAll, for example console.log("[shift-cleanup]", specName, closed). Do not commit this logging.
Paste a short table: spec name, number of shifts closed.
Any spec that closes more than 0 shifts left a shift open. For each one, write which test opened it and whether that is expected (the test opens a shift on purpose) or a leak.
If you find a real leak, fix that test so it closes its own shift, and prove it with the same table again. If nothing leaks, write that down. Do not invent a cause.
4. Node.js 20 warning in CI
The last CI runs show a warning that Node.js 20 is deprecated for actions/*.

Copy the exact warning text from the annotations API and paste it.
In .github/workflows/, update only the actions the warning names, to the version the warning or the action's own README says runs on the newer Node. Do not guess version numbers. If you cannot confirm a version, leave that action and write why.
Do not change any other workflow step.
5. Proof
git grep -n "catch {}\|\.catch(() => {})" apps/admin/e2e — paste the result. Any hit inside shift cleanup is a bug.
Run the whole E2E suite locally once with retries: 0 after your changes. Paste the summary as printed.
Commit and push. Check every commit with ci-status.cjs on its exact head_sha. The last commit, including a docs-only one, must be green.
For the final commit, paste one line per job (test, smoke-prod, load-check) and the Playwright Run Summary annotation, as printed.
Confirm the Node.js 20 warning is gone from the final run, or paste it if it is still there.
If CI fails, read the annotation, fix the cause and log it. Three failed fix attempts on one test means BLOCKED: log it with the run URLs and the test name.
Then stop. Do not start Phase 3.
