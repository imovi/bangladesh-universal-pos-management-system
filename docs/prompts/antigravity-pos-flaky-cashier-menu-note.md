Prompt for Antigravity — flaky cashier menu E2E test
Copy everything below the line into Antigravity.

The GitHub token support is accepted. a8104aa and 824f303 are green.

But b19d054 (run 45598833108) failed in the test job. With CI retries now off, the github reporter named the test:

[chromium] › e2e/pos-flow.spec.ts:51:3 › Part C: POS Selling Screen & Register Lifecycle Flow
  › Flow 1: Counter-only Cashier login lands directly on /pos and enforces discount limit
Error: expect(locator).toBeVisible() failed
Locator: locator('[data-testid="cashier-menu-dropdown"]')
  66 |     const cashierBlock = page.locator('[data-testid="cashier-name-block"]');
  67 |     await cashierBlock.click();
> 68 |     await expect(page.locator('[data-testid="cashier-menu-dropdown"]')).toBeVisible({ timeout: 5000 });
The log says "clicking before hydration", but nothing was changed. The next run passed by chance. This note fixes the cause. It is about 1 to 2 hours of work. Do it unattended, top to bottom.

All rules still apply:

CI results only from scripts/ci-status.cjs output, or from the public jobs and annotations API, pasted as they are;
each CI line in the form - CI: `<sha>` → run `<id>` → <status> <conclusion>;
never skip, add retries, fixme, or a longer blind timeout;
every number and output block must be copied from real command output. Paste JSON and test summaries as they are printed. Do not retell them in your own words.
wait about 12 minutes after a push, then check at most once every 5 minutes.
Save this text as docs/prompts/antigravity-pos-flaky-cashier-menu-note.md in your first commit. Log the work under ## Flaky cashier menu note at the end of docs/overnight-log.md.

Before each commit, run git status, and add files by name. Never use git add . or git add -A.

1. Prove the cause before you fix it
"Clicking before hydration" is a guess until you show it. Read apps/admin/src/app/pos/page.tsx around the cashier-name-block button (about line 1869) and the cashier-menu-dropdown (about line 1910). Then check each possible cause and write what you found for each:

Hydration. The button is in the server HTML, so Playwright can click it before React attaches the onClick. To reproduce, slow the page down, for example with CPU throttling through a CDP session (Emulation.setCPUThrottlingRate with rate 6), and run the test with --repeat-each=20.
Something covers the button. A dialog or overlay opens right after /pos loads, for example the "shift in use" or register-picker dialog the same test handles a few lines later. Does it catch the click or close the menu?
Re-render. The menu opens and then closes again, because state is reset when shift, register or user data loads.
A second click. Some code toggles the menu twice.
Paste:

the failing run's summary from your reproduction;
which cause it was, and the lines of code that show it.
If you cannot reproduce it in 20 repeats with throttling, say so, and keep looking at causes 2 to 4. Do not fix a cause you have not shown.

2. Fix the cause
If it is hydration, fix it in the app, not only in the test. A cashier on a slow phone can tap before hydration too, and then nothing happens.

Render the button disabled until the page has mounted, for example with a mounted state set in useEffect.
Or add data-hydrated="true" to the POS root after mount.
The test then waits for that state before clicking: await expect(cashierBlock).toBeEnabled(), or wait for [data-hydrated="true"].

If it is an overlay, a re-render or a double toggle, fix that in the app. Then make the test wait for the real ready state (for example the dialog is gone), not for time.

3. Same pattern elsewhere
The same test still has await page.waitForTimeout(500) after the register switch.

Search all of apps/admin/e2e for:
a click right after waitForURL or goto, with nothing waited on in between;
waitForTimeout( used to wait for something.
Fix each one the same way.
List every file and line you changed.
4. Proof
Run e2e/pos-flow.spec.ts with --repeat-each=20 and CPU throttling on. Paste the summary. It must be 0 failed.
Run the whole E2E suite 3 times in a row locally with retries: 0. Paste the 3 summaries as printed.
Commit and push. Then check every commit with ci-status.cjs on its exact head_sha. The last commit, including a docs-only one, must be green.
For the final commit, paste:
one line per job from the jobs API: test, smoke-prod and load-check, all success;
the Playwright Run Summary annotation of the test job, as printed.
If CI fails on any test, read the annotation, fix the cause and log it. Three failed fix attempts on one test means BLOCKED: log it with the run URLs and the test name.
5. Report
At the end of ## Phase 1F, follow-up in docs/overnight-report.md, under "Problems found during the run", add one line:

the flaky cashier menu test;
what the real cause was;
the fixing commit.
In the same report, the commit table rows for 0e0f1db and 91d472f still say "intermittent E2E runner timeout". Change them to "E2E step failed with exit code 1, failing test unknown", to match the log.

Then stop. Do not start Phase 3.
