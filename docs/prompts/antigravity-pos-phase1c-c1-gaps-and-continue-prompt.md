You are working in D:\pos system (repo imovi/bangladesh-universal-pos-management-system). I am going to sleep again. You will work alone for 5 to 7 hours.

Save this file as docs/prompts/antigravity-pos-phase1c-c1-gaps-and-continue-prompt.md and commit it with your first commit.

docs/prompts/antigravity-pos-phase1c-returns-due-transfers-prompt.md (the Phase 1C prompt) stays the main specification. All its rules apply unchanged: the unattended mode, the four additional rules (faster test loop, hashes and CI results copied from git log and the API, screenshots taken from the production build, and screen numbers checked against the API), and the backend rules. Where this file and the Phase 1C prompt disagree, this file wins.

Log under a new heading ## Phase 1C, run 2 in docs/overnight-log.md.

Step 0. Find out where the last run stopped (10 minutes)
Run git status and git log --oneline -10.
If uncommitted C2 work is in the working tree, do not throw it away. Read it, finish it, and commit it as part of C2 below.
Write in the log what was committed, what was uncommitted, and what you did with it.
Step 1. Close the gaps in C1 (returns and exchanges)
The review found that C1 (cf48a3b, b15edd7) is good in the money calculation, the drawer check, the void block and idempotency. These parts of the Phase 1C prompt are still missing. Do all of them in one commit, fix(returns): ..., before any new feature.

Parallel over-return test. In apps/api/test/returns-engine.spec.ts, send two return requests for the last returnable unit of one line at the same time (Promise.all, different ids). Exactly one gets 2xx and the other gets the over-return error. Afterwards, the returned quantity in the database equals the sold quantity, and the stock went up by exactly 1. Run this test 5 times in a loop locally to make sure it is not flaky, and log the result. The current lock is pg_advisory_xact_lock(hashtext(itemId)). Keep it if the test passes. Write in the log why an advisory lock was chosen instead of SELECT ... FOR UPDATE on the sale lines. Make sure two different lines of one return always take their locks in the same order (sort by id), so two returns cannot deadlock.
Idempotent retry tests, for both POST /sales/:id/returns and the exchange endpoint:
The same id and the same body returns the first result. No second return row, no second stock movement, and no second cash effect.
The same id with a different body returns 409 IDEMPOTENCY_CONFLICT.
Exchange in both directions. Write two separate tests:
(a) The new items cost more and the customer pays the difference. Check the shift's cash and the payment method totals.
(b) The new items cost less and the shop refunds the difference in cash. Check the expected cash goes down by exactly that amount, and check the drawer limit applies. Also apply the cashier's discount limit to the new part of an exchange, and test it.
More cross-tenant tests. For every new endpoint that takes an id, use tenant A's token with tenant B's id and expect 404 with no data:
GET return detail
the return list filtered by tenant B's sale
POST return
POST exchange
Playwright test at /pos, done the way a cashier does it. Add a new test to apps/admin/e2e/returns-flow.spec.ts. Make the return through the UI, not through the API:
Open a shift and make a sale through the API helper.
On /pos, press F6, type the invoice number, return 1 unit as resellable with a cash refund, and confirm.
On the "ফেরত রসিদ" receipt, assert that the refund amount equals totalRefundMinor from GET /sales/returns/:id, and that the receipt is titled "ফেরত রসিদ".
Assert the product card's stock went up by 1 after a page reload.
Then do an exchange through the UI where the customer pays the difference, and check the amount due on screen against the API.
Dashboard. Add a "ফেরত" / "Returns" figure for today (count and amount). Today's net sales are sales minus returns. Add a Playwright assertion that compares this figure with the API.
Global guard. Add /sales/returns, one return detail page, and the sale detail page of a sale with a return to global-data-integrity-guard.spec.ts, in both Bangla and English.
Return number format. The Phase 1C prompt says REG01-R-261116-0001 (YYMMDD), but the code makes REG01-R-20261116-0001. Decide which format to use and write the reason in the log:
Use the same date format as the sale invoice numbers, so receipts look the same.
If sales use YYYYMMDD, keep YYYYMMDD and record this as a decision I may want to change.
Do not rename returns that already exist.
File size.
Split apps/api/src/modules/sales/returns.service.ts (990 lines) into a return service, an exchange service and a shared helper for the refund and lock logic.
Split apps/admin/src/components/pos/return-modal.tsx (853 lines) into smaller components.
Each file must be under 800 lines. Do not change behaviour, and the existing tests must pass unchanged.
Screenshots to docs/screenshots/c1/, taken from the production build:
the /pos return dialog
the exchange cart
the "ফেরত রসিদ" receipt in 80 mm and 58 mm
/sales/returns
a return detail page
a sale detail page with its returns Take each at 1440 px and 375 px, in Bangla and light mode. Take /pos in dark mode too.
Step 2. Continue Phase 1C
After Step 1 is pushed and CI is green, continue the work list of the Phase 1C prompt from where it stopped: C2 (sales on credit), then C3 (stock transfers), then C4 (barcode labels), then C5 (reports), then the "If time remains" items. Each milestone needs all of the tests the Phase 1C prompt lists for it, including:

the Playwright test on /pos that a cashier would do
the screen-versus-API number check
the entry in the global guard
the screenshot folder
Do not count a milestone as done if any of these is missing. Leave it marked as partly done in the report instead.

Pace: C1 took about 2 hours. If a milestone takes more than 2.5 hours, stop adding extras to it: finish the required tests, push, and move on. The required items are always done before the "If time remains" items.

Final report
Add a ## Phase 1C, run 2 section to docs/overnight-report.md and print the same in chat. Use the same seven points as the Phase 1C prompt, plus:

a list of the C1 gaps 1 to 10 above, each with done or not done and its commit hash;
the result of the parallel test from 5 local runs.
