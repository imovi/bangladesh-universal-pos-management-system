# Prompt for Antigravity — Phase 1D fixes from a hands-on test

You are working in D:\pos system (repo imovi/bangladesh-universal-pos-management-system). You will work alone for several hours, and nobody will answer questions.

Save this file as docs/prompts/antigravity-pos-phase1d-fixes-prompt.md and commit it with your first commit. Log under ## Phase 1D, fixes in docs/overnight-log.md.

All rules of docs/prompts/antigravity-pos-phase1d-offline-mode-prompt.md still apply:

Before the next item, check the API for the exact head_sha of every push.
If the build is red, fix it first. 3 failed attempts mean BLOCKED, and you stop.
Kill any command that is silent for 10 minutes.
Never stop without a log entry.
Copy hashes and run ids from git log and the API, never from memory.
Two more rules:

Never read, print or use any credential from this computer. That includes Git Credential Manager, tokens and plugin accounts. Use only the public GitHub API without auth. If a CI log needs auth, write "could not read the CI log" and reproduce the failure locally.
Never write a commit hash or run id you did not just copy from git log or the API. The Phase 1D report had 5 hashes and 5 run ids that do not exist.
How this was tested
The app was tested by hand at /pos on the dev database, with the API and the admin production build running, and the cashier logged in.

What worked:

With the browser truly offline, the sale got REG01-O-261119-0004 and is_offline = true. occurred_at was the real sale time, and the sale synced once, with no duplicates.
A bKash reference was kept.
Header actions were disabled with the right tooltip.
What failed is listed in Step 1.

Step 0. Fix the Phase 1D report (docs only)
Skip any part that is already done.

docs/overnight-report.md, Phase 1D table: replace the fake hashes 40c5e31, 7b539bf, cff0e9c, f569fe3, ae25381 and their fake run ids with the real ones: f8c462f, d5c2250, 44cc765, d88dec0 → c1c78aa → c4ba535, 6272c90. List every red run: d88dec0, c1c78aa, 8777d83, eeaddf9, 50caaef, b1dcbe3, 3e38a68.
Section 5 must say that 4 red runs in a row (eeaddf9 to 3e38a68) broke the 3-attempt rule, and why you did not stop.
Fix the permission names in section 2 to match packages/shared/src/permissions.ts: sale.offline_review, register.manage_offline.
Write in the log that you read the GitHub credential from Git Credential Manager in the last run.
Step 1. Fixes, each its own commit with a test
1. Server unreachable while the browser says "online" (most important)
This is the common case in Bangladesh: the WiFi router is up, but the internet or the server is down. navigator.onLine stays true. Reproduced by stopping the API while the page stayed online. What happened:

The sale could not reach the server, so the app gave the customer a receipt with an offline number, REG01-O-261119-0002. But the outbox payload had isOffline: false.
When the server came back, the outbox sent it. The server treated it as an online sale:
It gave it a new number, REG01-261119-0012. The number on the customer's receipt now exists nowhere on the server, so a later return or exchange with that receipt cannot be found.
It set occurred_at to the sync time (16:54:42) instead of the sale time the client sent (16:53:30).
synced_at stayed null and is_offline stayed false.
During the outage, the header pill showed "সিঙ্ক হচ্ছে… ১টি বাকি" instead of অফলাইন.
Return (F6) was enabled and failed with "সার্ভারের সাথে সংযোগে ত্রুটি হয়েছে".
Rules for the fix:

The receipt number is the server number. Whatever number is printed on the customer's receipt must be the number stored on the server. A sale gets a server number only if the server answered before the receipt was shown. Otherwise it is an offline sale, and these are fixed before any retry:

isOffline: true;
the -O- number;
occurredAt.
Use a short timeout for the online send. For example 6 seconds; put it in a named constant. On a network error or a timeout, the sale becomes offline as above.

The response can be lost after the server saved the sale. Example: the first request was saved as an online sale, the response was lost, and the retry carries the offline payload with the same id. The server must not create a second sale and must not answer 409:

return the existing sale;
add a review flag NUMBER_MISMATCH whose details hold both numbers;
let /sales search and the return search find the sale by either number.
Pick how to store the second number, for example a nullable offline_invoice_number column with a unique index per tenant. Log the choice.

The connection state must come from the server, not only from navigator.onLine:

check /health with a short timeout every 15 s while /pos is open, and right after any failed request;
"অফলাইন" when the server cannot be reached;
"সিঙ্ক হচ্ছে" only while a send is actually in progress;
"সিঙ্ক হয়নি" for items that failed for good.
When the server cannot be reached, every action that needs the server is disabled, exactly as in the true-offline case: return/exchange, credit, cash in/out and close shift.

The server stores occurred_at from the client for every offline sale, with the same clamping to the shift window. Never use the sync time for one.

Tests:

Playwright, "lie-fi":
Keep the browser context online, but make every /api/v1/** request fail with page.route(..., r => r.abort()).
Make 2 sales: cash, and bKash with a reference.
Assert the pill says অফলাইন and that return is disabled.
Remove the route and wait for sync. Then assert from the API, for each sale:
it exists exactly once;
invoiceNumber equals the number on the receipt;
isOffline is true;
occurredAt is the sale time, not the sync time.
Playwright, lost response:
Let the first POST /sales reach the server, then abort only its response (route.fetch(), then route.abort()).
Assert there is one sale and a NUMBER_MISMATCH flag, and that both numbers find it.
API test: an offline sale's occurred_at is the client value, clamped to the shift window.
2. F6 and the cart-panel return button work while offline
In the true-offline state, the header return button is disabled, but the second "ফেরত (F6)" button above the cart is enabled.
Pressing F6 opens the return dialog.
Fix: both must be disabled whenever the app is offline or cannot reach the server. Check every keyboard shortcut against the same rule (F6 and any shortcut for cash in/out or close shift).
Test: add assertions to offline-selling.spec.ts Scenario 3 for the cart-panel button and the F6 key.
3. The shift sales list goes stale
After sales sync, "শিফট বিক্রি তালিকা" still shows the old list. It showed 7 receipts, and the 3 synced sales were missing until a page reload; after the reload it showed 10.

Fix: refresh the list when it opens and when the outbox finishes a sync.
Unsynced sales: offline sales that are not synced yet must also appear in the list, from localSales, marked "সিঙ্ক হয়নি", so the cashier can reprint them.
Duplicates: localSales currently stores 2 rows per online sale, one under the -O- number and one under the server number. Keep one row per sale id, holding both numbers.
Test: Playwright.
4. The dev database was empty
Before this test, the dev database universal_pos had 0 tenants, 0 users and 0 sales. Something wiped it after the e2e guard was added.

Find which script or test truncates or resets universal_pos. Check:
db:reset:dev;
setup-e2e-db.ts;
any test that uses MIGRATION_DATABASE_URL or reads .env.
Make every destructive script refuse to run unless its target database name ends in _e2e or _test. The only exception is db:reset:dev when it is called by name with --yes.
Log what you found.
5. npm run start:dev in apps/api is broken
Started with tsx watch src/main.ts, every login returns 500: "Cannot read properties of undefined (reading 'login')". Nest dependency injection gets no decorator metadata under tsx/esbuild. Only npm run build followed by node dist/main.js works.

Fix: change the dev script so it emits decorator metadata, for example nest start --watch or tsx with the SWC plugin. Log which one you chose.
Check: start it and run a login with curl.
Write the exact steps for running the app by hand on the dev database into docs/offline-mode.md or the README.
6. Small items
Size order in the variant grid: sizes appear as L, XL, M and M, L, XL on different products. Sort sizes by a fixed order: XS, S, M, L, XL, XXL, then numbers ascending, then anything else alphabetically. Use the same order everywhere sizes are listed.
Service worker: in the in-app test browser, registration failed with "An unknown error occurred when fetching the script", even though GET /sw.js returns 200 with application/javascript. It may be specific to that browser. Check in Chrome that the worker registers on localhost:3000 from the production build. Log the result and the steps.
Final report
Add ## Phase 1D, fixes to docs/overnight-report.md and print the same in chat:

a table of every item: status, the real commit hash, and the CI run id and conclusion;
what wiped the dev database;
every BLOCKED entry and every rule you could not follow;
decisions I may want to change.
