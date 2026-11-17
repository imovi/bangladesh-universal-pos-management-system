You are working in D:\pos system (repo imovi/bangladesh-universal-pos-management-system). You will work alone for several hours, and nobody will answer questions.

Save this file as docs/prompts/antigravity-pos-phase1c-run3-prompt.md and commit it with your first commit.

All rules of docs/prompts/antigravity-pos-phase1c-returns-due-transfers-prompt.md still apply, unchanged:

unattended mode;
the faster test loop;
commit hashes and CI results copied from git log and the API, never from memory;
screenshots from the production build;
every number on a screen checked against the API;
the backend rules.
Log under ## Phase 1C, run 3 in docs/overnight-log.md.

CI rule, stricter than before. In run 2, CI stayed red for 6 pushes in a row while new features were built on top. That must not happen again:

After every push, check the API for that exact head_sha before you start the next item.
If it is red, the next item is fixing CI. Nothing else.
After 3 failed attempts, write BLOCKED: CI red with the run URLs and the names of the failing tests, and stop building features.
"All tests pass locally" never counts as green.
If a command hangs (no output for 10 minutes), kill it, write it in the log, and continue. The last run stopped with C5 half-done and nothing committed for more than 2 hours.

Step 0. Finish C5 (Reports), which is uncommitted in the working tree
The working tree has uncommitted C5 work. Do not throw it away:

the returns and damaged-stock report pages;
reports-c5.spec.ts (API and e2e);
the reports service changes;
2 screenshots in docs/screenshots/c5/.
Finish C5 exactly as the Phase 1C prompt describes it:

Returns report: by day, branch, product, reason and condition, plus the return rate per product.
Damaged stock report: built from sale_return_damaged and transfer_loss.
Due ageing report: CSV export (the report itself was built in C2).
Profit report: subtracts returns. Write a test with real numbers: sale, partial return, and the expected profit to the poisha.
Every report:
follows the branch in the header;
uses the shared date range picker and the table standard;
has at least one number on screen checked against the API;
is added to global-data-integrity-guard.spec.ts.
Screenshots in docs/screenshots/c5/ for every report, at 1440 px and 375 px.
Commit and push C5, and check CI.

Step 1. The /pos header: fix the overlap for good, and make it adjust to any name length
What is wrong
At about 1920 px wide, the shift badge "শিফট চলমান" sits under the cashier block "Tariqul Islam". The badge text is cut off, and the cashier block is drawn on top of it.

Other problems in the same header:

the register selector shows "Main Counter (RE", cut in the middle of a word;
the branch name is cut ("GFS-01 - Gulshan Flags...").
Item 0 (931cb43) added pos-header-layout.spec.ts, and it passed. So that test cannot catch this bug. Before you fix anything, find out why it passed:

did the text overflow its element's box (overflow: visible)?
did the test measure elements other than the ones the eye sees?
was this width never tested?
Write the reason in the log.

Rules for the new header
Use layout rules, not fixed pixel widths.
Use one row with three zones: left (shop, branch, register), middle (shift and cashier), right (actions).
Use CSS grid or flex, with min-w-0 on the zones that may shrink and shrink-0 on the ones that must not.
Do not use max-w-[70px]-style limits tuned for one name or one language.
Shift and cashier become one block. Show them as a single pill, for example "● শিফট চলমান · Tariqul Islam ▾".
The pill opens the cashier menu.
The menu holds the discount limit, the shift start time, and back to office.
Because shift and cashier are one block, they can never overlap.
Long text shrinks with "…", never by being cut or by overlapping.
The cashier, branch and register names use truncate with an ellipsis.
The full text appears in a title tooltip and in the menu.
The register shows its short code ("REG01") when space is tight, and its full name only when it fits.
The header adjusts in steps as the screen gets narrower:
wide: action buttons show an icon and a label;
medium: icon only, with a tooltip and an aria-label;
narrow: the less-used actions (keyboard shortcuts, theme, language, back to office) move into a "⋯" menu.
Return (F6), Close shift and Cash management stay visible at every width.
The header stays one row at 768 px and wider.
A test that catches this kind of bug
Replace or extend apps/admin/e2e/pos-header-layout.spec.ts.

Widths: 375, 768, 1024, 1280, 1366, 1440, 1536 and 1920 px.
Languages: Bangla and English.
Names: run with the seed names, and again with long names. The test creates the long names through the API and removes them afterwards:
cashier "Mohammad Abdur Rahman Chowdhury";
branch "Gulshan Flagship Store — Road 11, Block C";
register "Main Counter Near Entrance Gate".
Checks:
The text of every visible header item does not overlap the text of any other item. Measure with Range.getBoundingClientRect() on the text nodes, not only the element boxes.
No text is clipped: scrollWidth <= clientWidth. The only exception is an element that deliberately ends in "…", and that element must have a title with the full text.
At 768 px and above, the header height equals one row.
Return, Close shift and Cash management are visible and clickable at every width.
Screenshots: save the header at each width to docs/screenshots/pos-header/, Bangla, light. Add dark mode at 1920 px.
Commit, push, check CI.

Step 2. Close the remaining Phase 1C gaps
Each of these is its own commit.

F6 shortcut test. In run 2, returns-flow.spec.ts was changed to click the return button first and to press F6 only as a fallback, so the F6 shortcut itself is no longer tested. Add a separate assertion: pressing F6 on /pos (with the focus in the search box, and again with the focus on the page body) opens the return dialog. Do this for each keyboard shortcut on /pos (F2, F4, F6, F8 and the others listed in the shortcuts dialog).
C4 screenshots. Only 4 desktop screenshots exist in docs/screenshots/c4/. Add:
375 px versions;
the print preview of each template (38×25, 50×30, A4 3×8), with the barcode number and price readable;
the generate-barcode action on the product page.
Test data leaking into the dev database. The dev database /pos shows a product "Custom Polo Shirt 6484" with 12 variants and stock 538. If a test created it, then tests are still writing into the dev database instead of universal_pos_e2e.
Find which test or script creates products named "Custom Polo Shirt" followed by a number.
Make it use the E2E database only. Add a guard that makes the Playwright global setup fail if DATABASE_URL does not point to universal_pos_e2e.
Write a script that removes the leftover test data from the dev database, and run it. Do not use a hand-written DELETE that bypasses movements: products with stock need their stock movements handled in the same way as the app does it. Otherwise, deactivate the products instead and log why.
Log what you found.
C1 to C4 audit against the Phase 1C prompt. Go through every "Rules", "Screens" and "Tests" bullet of C1 to C4 in the Phase 1C prompt. Make a table in the log: bullet, done / partly / missing, file or test that proves it. Fix every "missing" item that takes less than 45 minutes, and list the rest.
Dashboard figures. Check these against the API with a Playwright assertion for each:
"আজ বাকি দেওয়া" (credit given today);
"আজ বাকি আদায়" (due collected today);
today's returns.
Step 3. If time remains
In this order, each its own commit:

(a) /pos at 1024 px and 375 px, with the return, exchange, credit payment and barcode dialogs open: no overflow, nothing hidden under the keyboard on a phone.
(b) A Bangla wording pass on all strings added in Phase 1C: short, the way a shopkeeper speaks, no mixed-language labels like "বকেয়া (Due)".
(c) Raise unit-test coverage of apps/admin/src/lib/pos/ and packages/shared/src/barcodes.ts.
Out of scope: promotions, loyalty, SMS, offline mode, payment gateways, e-commerce.

Final report
Add ## Phase 1C, run 3 to docs/overnight-report.md and print the same in chat. Include:

A table of every step and item: status, the real commit hash from git log, and the CI run id and conclusion from the API.
Why the old header test passed while the bug existed.
The C1 to C4 audit table.
What happened with the test data in the dev database.
Every BLOCKED entry, and every rule you could not follow, with the reason.
Decisions I may want to change.
What you could not verify, and why.
