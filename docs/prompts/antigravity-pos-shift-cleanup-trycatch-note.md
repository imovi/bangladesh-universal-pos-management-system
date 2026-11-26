Prompt for Antigravity — shift cleanup try/catch fix
Copy everything below the line into Antigravity.

Review checked 3e70141. CI for it (run 45876518382) is green:

test: 161 passed (8.2m);
smoke-prod: restarts=0;
load-check: scenario 3 salesCount 50000/50000.
The Node.js 20 warning is gone from that run. The actions update to v7 is accepted.

Review found two things to fix. This is under 1 hour of work. Do it unattended, top to bottom.

All rules still apply:

CI results only from scripts/ci-status.cjs output, or from the public jobs and annotations API, pasted as they are;
each CI line in the form - CI: `<sha>` → run `<id>` → <status> <conclusion>;
never skip, add retries, fixme, or a longer blind timeout;
every number and output block must be copied from real command output;
wait about 12 minutes after a push, then check at most once every 5 minutes;
never delete or rewrite earlier lines in docs/overnight-log.md. Only add new lines at the end;
add files by name. Never use git add . or git add -A. Restore docs/screenshots with git restore docs/screenshots before each commit.
Save this text as docs/prompts/antigravity-pos-shift-cleanup-trycatch-note.md in your first commit. Log the work under ### Shift cleanup try/catch fix at the end of docs/overnight-log.md.

1. Take closeAllOpenShifts out of try/catch
The last note said: "Never wrap that call in try/catch. If it fails, the test must fail." In 4 specs, beforeAll still calls it inside a try block whose catch ignores every error:

Spec	Where the error is swallowed
apps/admin/e2e/coupons-pos-flow.spec.ts	} catch {} at line 69
apps/admin/e2e/loyalty-pos-flow.spec.ts	} catch {} at line 70
apps/admin/e2e/promotions-pos-flow.spec.ts	} catch {} at line 66
apps/admin/e2e/offline-selling.spec.ts	catch { // Ignore } around line 53, and the call is also inside if (loginRes.ok()) and if (token)
So if a shift fails to close, the test goes on silently. That is the same problem a6b78f6 was meant to remove.

Do this in each of the 4 specs:

Move await closeAllOpenShifts(request); out of the try block. Put it as the first line of beforeAll, before the try. The helper logs in by itself, so it does not need the token or the if checks.
Do not leave a second call inside the try.
Do not change anything else inside those try blocks in this note: the promotion cleanup, the register allowOffline patch and the shifts/open call stay as they are.
Then check that no shift cleanup is inside a try anywhere:

Run git grep -n "closeAllOpenShifts" apps/admin/e2e and paste the result.
For each hit, open the file and confirm the call is not inside a try block. Write one line per file: <file>:<line> — not inside try. grep for catch {} alone cannot show this, because a try can start many lines above the call.
2. Correct the log
Under ### Shift cleanup try/catch fix, add:

A correction line: "The line 'Zero hits inside shift cleanup' under ### Shift cleanup sync was wrong. In 4 specs, closeAllOpenShifts was still inside a try with an empty catch. This note fixes that."
The proof that ### Shift cleanup sync left out, for 3e70141. Get it with ci-status.cjs and the jobs and annotations API, and paste as printed:
- CI: `3e70141` → run `45876518382` → completed success;
one line per job: test, smoke-prod, load-check;
the Playwright Run Summary annotation of the test job;
one line saying whether a Node.js 20 warning is in that run's annotations.
In docs/overnight-report.md, add a row for 3e70141 to the table in ## Phase 1F, follow-up, with run 45876518382 and SUCCESS. Add a row for each new commit of this note.
3. Proof
Run the 4 changed specs locally with retries: 0. Paste the summary as printed.
Show that the error is now loud. Temporarily change API_BASE_URL in apps/admin/e2e/helpers/shift-cleanup.ts to a wrong port, for example 4999. Run coupons-pos-flow.spec.ts once. Paste the error line from beforeAll. It must show that the test failed. Then restore the file and run git diff apps/admin/e2e/helpers/shift-cleanup.ts. It must be empty. Do not commit this change.
Run the whole E2E suite locally once with retries: 0. Paste the summary as printed.
Commit and push. Check every commit with ci-status.cjs on its exact head_sha. The last commit, including a docs-only one, must be green.
For the final commit, paste one line per job (test, smoke-prod, load-check) and the Playwright Run Summary annotation, as printed.
If CI fails, read the annotation, fix the cause and log it. Three failed fix attempts on one test means BLOCKED: log it with the run URLs and the test name.
Then stop. Do not start Phase 3.
